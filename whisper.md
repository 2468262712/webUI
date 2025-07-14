/* eslint-disable no-sparse-arrays */
/* eslint-disable react-hooks/exhaustive-deps */
// eslint-disable-next-line object-curly-newline
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { wsService, MessageEvent } from '@/services/websocket-service';
import {
  WebSocketContext, HistoryInfo, defaultWsUrl, defaultBaseUrl,
} from '@/context/websocket-context';
import { ModelInfo, useLive2DConfig } from '@/context/live2d-config-context';
import { useSubtitle } from '@/context/subtitle-context';
import { audioTaskQueue } from '@/utils/task-queue';
import { useAudioTask } from '@/components/canvas/live2d';
import { useBgUrl } from '@/context/bgurl-context';
import { useConfig } from '@/context/character-config-context';
import { useChatHistory } from '@/context/chat-history-context';
import { toaster } from '@/components/ui/toaster';
import { useVAD } from '@/context/vad-context';
import { AiState, useAiState, AiStateEnum } from "@/context/ai-state-context";
import { useLocalStorage } from '@/hooks/utils/use-local-storage';
import { useGroup } from '@/context/group-context';
import { useInterrupt } from '@/hooks/utils/use-interrupt';
import { useFooter } from '@/hooks/footer/use-footer';
import { useMicToggle } from '@/hooks/utils/use-mic-toggle';

function WebSocketHandler({ children }: { children: React.ReactNode }) {
  const [wsState, setWsState] = useState<string>('CLOSED');
  const [wsUrl, setWsUrl] = useLocalStorage<string>('wsUrl', defaultWsUrl);
  const [baseUrl, setBaseUrl] = useLocalStorage<string>('baseUrl', defaultBaseUrl);
  const { aiState, setAiState, backendSynthComplete, setBackendSynthComplete } = useAiState();
  const { setModelInfo } = useLive2DConfig();
  const { setSubtitleText } = useSubtitle();
  const { clearResponse, setForceNewMessage } = useChatHistory();
  const { addAudioTask } = useAudioTask();
  const bgUrlContext = useBgUrl();
  const { confUid, setConfName, setConfUid, setConfigFiles } = useConfig();
  const [pendingModelInfo, setPendingModelInfo] = useState<ModelInfo | undefined>(undefined);
  const { setSelfUid, setGroupMembers, setIsOwner } = useGroup();
  const { startMic, stopMic, autoStartMicOnConvEnd } = useVAD();
  const autoStartMicOnConvEndRef = useRef(autoStartMicOnConvEnd);
  const { interrupt } = useInterrupt();
  const { handleMicToggle, micOn } = useMicToggle();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const whisperIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const WAKE_WORDS = ['你好，小新', '小新你好', '小新，开始对话', '小心小心','你好小心','你好，小心','小心，开始对话'];
  const END_WORDS = ['结束对话', '关闭对话', '停止对话', '请结束对话'];
  const wakeupMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const wakeupChunksRef = useRef<Blob[]>([]);
  const wakeupIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isWakeupListeningRef = useRef(false);

  useEffect(() => {
    autoStartMicOnConvEndRef.current = autoStartMicOnConvEnd;
  }, [autoStartMicOnConvEnd]);

  const startRecognition = useCallback(async () => {
    if (!mediaRecorderRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (event) => {
          audioChunksRef.current.push(event.data);
        };
        mediaRecorder.onstop = async () => {
          if (audioChunksRef.current.length > 0) {
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
            await sendToWhisper(audioBlob);
            audioChunksRef.current = [];
          }
        };
        mediaRecorderRef.current = mediaRecorder;
      } catch (e) {
        console.error('无法获取麦克风权限:', e);
        toaster.create({
          title: '无法获取麦克风权限',
          type: 'error',
          duration: 5000,
        });
        return;
      }
    }
    audioChunksRef.current = [];
    mediaRecorderRef.current.start();
    whisperIntervalRef.current = setInterval(() => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.requestData();
      }
    }, 5000);
  }, []);

  const stopRecognition = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (whisperIntervalRef.current) {
      clearInterval(whisperIntervalRef.current);
      whisperIntervalRef.current = null;
    }
  }, []);

  const startWakeupListening = useCallback(async () => {
    if (isWakeupListeningRef.current) return;
    isWakeupListeningRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      wakeupMediaRecorderRef.current = mediaRecorder;
      wakeupChunksRef.current = [];
      mediaRecorder.ondataavailable = (event) => {
        wakeupChunksRef.current.push(event.data);
      };
      mediaRecorder.onstop = async () => {
        if (wakeupChunksRef.current.length > 0) {
          const audioBlob = new Blob(wakeupChunksRef.current, { type: 'audio/wav' });
          await sendToWhisper(audioBlob, true);
          wakeupChunksRef.current = [];
        }
        if (isWakeupListeningRef.current) {
          mediaRecorder.start();
          setTimeout(() => {
            if (mediaRecorder.state === 'recording') mediaRecorder.stop();
          }, 2000);
        }
      };
      mediaRecorder.start();
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') mediaRecorder.stop();
      }, 2000);
    } catch (e) {
      console.error('唤醒监听无法获取麦克风权限:', e);
      toaster.create({
        title: '唤醒监听无法获取麦克风权限',
        type: 'error',
        duration: 5000,
      });
      isWakeupListeningRef.current = false;
    }
  }, []);

  const stopWakeupListening = useCallback(() => {
    isWakeupListeningRef.current = false;
    if (wakeupMediaRecorderRef.current) {
      if (wakeupMediaRecorderRef.current.state !== 'inactive') {
        wakeupMediaRecorderRef.current.stop();
      }
      wakeupMediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      wakeupMediaRecorderRef.current = null;
    }
    if (wakeupIntervalRef.current) {
      clearInterval(wakeupIntervalRef.current);
      wakeupIntervalRef.current = null;
    }
  }, []);

  async function sendToWhisper(audioBlob: Blob, isWakeup = false) {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', 'whisper-large-v3-turbo');
    try {
      const response = await fetch('http://192.168.101.46:7123/v1/audio/transcriptions', {
        method: 'POST',
        body: formData,
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) {
        const err = await response.text();
        console.error('API请求失败', err);
        return;
      }
      const result = await response.json();
      if (result.text) {
        const transcript = result.text.trim();
        console.log('whisper-large-v3-turbo 转录结果:', transcript);
        if (WAKE_WORDS.some(word => transcript.includes(word)) && isWakeup && !micOn) {
          console.log('检测到唤醒词，开启麦克风!');
          handleMicToggle();
          stopWakeupListening();
        }
        if (END_WORDS.some(word => transcript.includes(word)) && micOn) {
          console.log('检测到结束词，关闭麦克风!');
          handleMicToggle();
        }
      }
    } catch (e) {
      console.error('whisper-large-v3-turbo 请求异常', e);
    }
  }

  useEffect(() => {
    if (!micOn) {
      startWakeupListening();
    } else {
      stopWakeupListening();
    }
    return () => {
      stopWakeupListening();
    };
  }, [micOn, startWakeupListening, stopWakeupListening]);

  useEffect(() => {
    if (pendingModelInfo) {
      setModelInfo(pendingModelInfo);
      setPendingModelInfo(undefined);
    }
  }, [pendingModelInfo, setModelInfo, confUid]);

  const {
    setCurrentHistoryUid, setMessages, setHistoryList, appendHumanMessage,
  } = useChatHistory();

  const handleControlMessage = useCallback((controlText: string) => {
    switch (controlText) {
      case 'start-mic':
        console.log('Starting microphone...');
        startMic();
        break;
      case 'stop-mic':
        console.log('Stopping microphone...');
        stopMic();
        break;
      case 'conversation-chain-start':
        setAiState(AiStateEnum.THINKING_SPEAKING);
        audioTaskQueue.clearQueue();
        clearResponse();
        break;
      case 'conversation-chain-end':
        audioTaskQueue.addTask(() => new Promise<void>((resolve) => {
          setAiState((currentState: AiState) => {
            if (currentState === AiStateEnum.THINKING_SPEAKING) {
              if (autoStartMicOnConvEndRef.current) {
                startMic();
              }
              return AiStateEnum.IDLE;
            }
            return currentState;
          });
          resolve();
        }));
        break;
      default:
        console.warn('Unknown control command:', controlText);
    }
  }, [setAiState, clearResponse, setForceNewMessage, startMic, stopMic]);

  const handleWebSocketMessage = useCallback((message: MessageEvent) => {
    console.log('Received message from server:', message);

    switch (message.type) {
      case 'control':
        if (message.text) {
          handleControlMessage(message.text);
        }
        break;
      case 'set-model-and-conf':
        setAiState(AiStateEnum.LOADING);
        if (message.conf_name) {
          setConfName(message.conf_name);
        }
        if (message.conf_uid) {
          setConfUid(message.conf_uid);
          console.log('confUid', message.conf_uid);
        }
        if (message.client_uid) {
          setSelfUid(message.client_uid);
        }
        setPendingModelInfo(message.model_info);
        if (message.model_info && !message.model_info.url.startsWith("http")) {
          const modelUrl = baseUrl + message.model_info.url;
          // eslint-disable-next-line no-param-reassign
          message.model_info.url = modelUrl;
        }

        setAiState(AiStateEnum.IDLE);
        break;
      case 'full-text':
        if (message.text) {
          setSubtitleText(message.text);
        }
        break;
      case 'config-files':
        if (message.configs) {
          setConfigFiles(message.configs);
        }
        break;
      case 'config-switched':
        setAiState(AiStateEnum.IDLE);
        setSubtitleText('New Character Loaded');

        toaster.create({
          title: 'Character switched',
          type: 'success',
          duration: 2000,
        });

        wsService.sendMessage({ type: 'fetch-history-list' });
        wsService.sendMessage({ type: 'create-new-history' });
        break;
      case 'background-files':
        if (message.files) {
          bgUrlContext?.setBackgroundFiles(message.files);
        }
        break;
      case 'audio':
        if (aiState === AiStateEnum.INTERRUPTED || aiState === AiStateEnum.LISTENING) {
          console.log('Audio playback intercepted. Sentence:', message.display_text?.text);
        } else {
          console.log("actions", message.actions);
          addAudioTask({
            audioBase64: message.audio || '',
            volumes: message.volumes || [],
            sliceLength: message.slice_length || 0,
            displayText: message.display_text || null,
            expressions: message.actions?.expressions || null,
            forwarded: message.forwarded || false,
          });
        }
        break;
      case 'history-data':
        if (message.messages) {
          setMessages(message.messages);
        }
        toaster.create({
          title: 'History loaded',
          type: 'success',
          duration: 2000,
        });
        break;
      case 'new-history-created':
        setAiState(AiStateEnum.IDLE);
        setSubtitleText('新对话');
        if (message.history_uid) {
          setCurrentHistoryUid(message.history_uid);
          setMessages([]);
          const newHistory: HistoryInfo = {
            uid: message.history_uid,
            latest_message: null,
            timestamp: new Date().toISOString(),
          };
          setHistoryList((prev: HistoryInfo[]) => [newHistory, ...prev]);
          toaster.create({
            title: '新的对话记录',
            type: 'success',
            duration: 2000,
          });
        }
        break;
      case 'history-deleted':
        toaster.create({
          title: message.success
            ? 'History deleted successfully'
            : 'Failed to delete history',
          type: message.success ? 'success' : 'error',
          duration: 2000,
        });
        break;
      case 'history-list':
        if (message.histories) {
          setHistoryList(message.histories);
          if (message.histories.length > 0) {
            setCurrentHistoryUid(message.histories[0].uid);
          }
        }
        break;
      case 'user-input-transcription':
        console.log('user-input-transcription: ', message.text);
        if (typeof message.text === 'string' && message.text.length > 0) {
          if (END_WORDS.some(word => message.text!.includes(word)) && micOn) {
            console.log('检测到结束词，正在关闭麦克风...');
            handleMicToggle();
          }
          appendHumanMessage(message.text);
        }
        break;
      case 'error':
        toaster.create({
          title: message.message,
          type: 'error',
          duration: 2000,
        });
        break;
      case 'group-update':
        console.log('Received group-update:', message.members);
        if (message.members) {
          setGroupMembers(message.members);
        }
        if (message.is_owner !== undefined) {
          setIsOwner(message.is_owner);
        }
        break;
      case 'group-operation-result':
        toaster.create({
          title: message.message,
          type: message.success ? 'success' : 'error',
          duration: 2000,
        });
        break;
      case 'backend-synth-complete':
        setBackendSynthComplete(true);
        break;
      case 'conversation-chain-end':
        if (!audioTaskQueue.hasTask()) {
          setAiState((currentState: AiState) => {
            if (currentState === AiStateEnum.THINKING_SPEAKING) {
              return AiStateEnum.IDLE;
            }
            return currentState;
          });
        }
        break;
      case 'force-new-message':
        setForceNewMessage(true);
        break;
      case 'interrupt-signal':
        interrupt(false);
        break;
      default:
        console.warn(`Unknown message type: ${message.type}`);
    }
  }, [
    handleControlMessage,
    setAiState,
    setConfName,
    setConfUid,
    setSelfUid,
    setPendingModelInfo,
    baseUrl,
    setSubtitleText,
    setConfigFiles,
    bgUrlContext,
    addAudioTask,
    aiState,
    setMessages,
    toaster,
    setCurrentHistoryUid,
    setHistoryList,
    appendHumanMessage,
    setGroupMembers,
    setIsOwner,
    setBackendSynthComplete,
    audioTaskQueue,
    setForceNewMessage,
    micOn,
    handleMicToggle,
  ]);

  useEffect(() => {
    wsService.connect(wsUrl);
  }, [wsUrl]);

  useEffect(() => {
    const stateSubscription = wsService.onStateChange(setWsState);
    const messageSubscription = wsService.onMessage(handleWebSocketMessage);
    return () => {
      stateSubscription.unsubscribe();
      messageSubscription.unsubscribe();
    };
  }, [wsUrl, handleWebSocketMessage]);

  const webSocketContextValue = useMemo(() => ({
    sendMessage: wsService.sendMessage.bind(wsService),
    wsState,
    reconnect: () => wsService.connect(wsUrl),
    wsUrl,
    setWsUrl,
    baseUrl,
    setBaseUrl,
  }), [wsState, wsUrl, baseUrl]);

  return (
    <WebSocketContext.Provider value={webSocketContextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

export default WebSocketHandler;
