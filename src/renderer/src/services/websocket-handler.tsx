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

  const WAKE_WORD = '你好，小薇';

  useEffect(() => {
    autoStartMicOnConvEndRef.current = autoStartMicOnConvEnd;
  }, [autoStartMicOnConvEnd]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error("此浏览器不支持语音识别。");
      toaster.create({
        title: '此浏览器不支持语音识别。',
        type: 'error',
        duration: 3000,
      });
      return () => {};
    }

    if (micOn) {
      return () => {};
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = false;

    const recognitionActiveRef = { current: false };
    let recognitionStopped = false;

    recognition.onstart = () => {
      recognitionActiveRef.current = true;
      recognitionStopped = false;
      console.log('后台语音识别服务已启动。');
    };

    recognition.onresult = (event) => {
      const last = event.results.length - 1;
      const transcript = event.results[last][0].transcript.trim();
      console.log('后台识别到:', transcript);

      if (transcript.includes(WAKE_WORD) && !micOn) {
        console.log('检测到唤醒词，开启麦克风!');
        handleMicToggle();
      }
    };

    recognition.onerror = (event) => {
      console.error('后台语音识别错误:', event.error);
      if (event.error === 'not-allowed') {
        toaster.create({
          title: '麦克风权限被拒绝，语音唤醒功能无法使用。',
          type: 'error',
          duration: 5000,
        });
      }
      if (!recognitionStopped && !micOn) {
        setTimeout(() => {
          if (!recognitionActiveRef.current && !recognitionStopped) {
            try {
              recognition.start();
              console.log('后台语音识别服务因错误已重启。');
            } catch (e) {
              if ((e as any).name === 'InvalidStateError') {
                // 已经在运行，无需重启
              } else {
                console.error('重启后台语音识别失败:', e);
              }
            }
          }
        }, 1000);
      }
    };

    recognition.onend = () => {
      recognitionActiveRef.current = false;
      if (!recognitionStopped && !micOn) {
        console.log('后台语音识别服务已停止，尝试重启...');
        setTimeout(() => {
          if (!recognitionActiveRef.current && !recognitionStopped) {
            try {
              recognition.start();
              console.log('后台语音识别服务已重启。');
            } catch (e) {
              if ((e as any).name === 'InvalidStateError') {
                // 已经在运行，无需重启
              } else {
                console.error('重启后台语音识别失败:', e);
              }
            }
          }
        }, 1000);
      }
    };

    try {
      recognition.start();
      console.log('后台语音识别服务已启动，正在监听唤醒词...');
    } catch (e) {
      console.error("启动后台语音识别失败: ", e);
    }
    
    return () => {
      recognitionStopped = true;
      try {
        recognition.stop();
      } catch (e) {
        // 忽略 stop 时的异常
      }
    };
  }, [micOn, handleMicToggle]);

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
    const END_WORD = '结束对话';

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
        if (message.text) {
          if (message.text.includes(END_WORD) && micOn) {
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
