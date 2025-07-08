/* eslint-disable no-sparse-arrays */
/* eslint-disable react-hooks/exhaustive-deps */
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
  const recognitionRef = useRef<any>(null);
  const recognitionActiveRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isStartingRef = useRef(false);
  const WAKE_WORDS = ['你好，小薇', '小薇你好', '开始对话', '唤醒小薇'];
  const END_WORDS = ['结束对话', '关闭对话', '停止对话', '请结束对话'];
  const WHISPER_API_URL = "http://192.168.101.46:7123/v1/audio/transcriptions";
  const WHISPER_MODEL = "whisper-large-v3-turbo";
  const RECORD_SECONDS = 3;

  useEffect(() => {
    autoStartMicOnConvEndRef.current = autoStartMicOnConvEnd;
  }, [autoStartMicOnConvEnd]);

  // 封装 start/stop 逻辑，防止重复 start
  const startRecognition = useCallback(() => {
    if (
      recognitionRef.current &&
      !recognitionActiveRef.current &&
      !isStartingRef.current
    ) {
      try {
        isStartingRef.current = true;
        recognitionRef.current.start();
        recognitionActiveRef.current = true;
        console.log('后台语音识别服务已启动，正在监听唤醒词...');
      } catch (e) {
        if ((e as any).name === 'InvalidStateError') {
          // 已经在运行，无需重启
        } else {
          console.error('启动后台语音识别失败: ', e);
        }
      } finally {
        isStartingRef.current = false;
      }
    }
  }, []);

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current && recognitionActiveRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionActiveRef.current = false;
    }
  }, []);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error("此浏览器不支持语音识别。");
      toaster.create({
        title: '此浏览器不支持语音识别。',
        type: 'error',
        duration: 3000,
      });
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      if (micOn) {
        stopRecognition();
        return;
      }

      if (!recognitionRef.current) {
        const recognition = new SpeechRecognition();
        recognition.lang = 'zh-CN';
        recognition.continuous = true;
        recognition.interimResults = false;

        recognition.onstart = () => {
          recognitionActiveRef.current = true;
          console.log('后台语音识别服务已启动。');
        };
        recognition.onresult = (event: any) => {
          const last = event.results.length - 1;
          const transcript = event.results[last][0].transcript.trim();
          console.log('后台识别到:', transcript);
          if (transcript.includes(WAKE_WORDS[0]) && !micOn) {
            console.log('检测到唤醒词，开启麦克风!');
            handleMicToggle();
          }
        };
        recognition.onerror = (event: any) => {
          console.error('后台语音识别错误:', event.error);
          if (event.error === 'not-allowed') {
            toaster.create({
              title: '麦克风权限被拒绝，语音唤醒功能无法使用。',
              type: 'error',
              duration: 5000,
            });
          }
          if (!micOn) {
            setTimeout(() => {
              startRecognition();
              console.log('后台语音识别服务因错误已重启。');
            }, 1000);
          }
        };
        recognition.onend = () => {
          recognitionActiveRef.current = false;
          if (!micOn) {
            setTimeout(() => {
              startRecognition();
              console.log('后台语音识别服务已重启。');
            }, 1000);
          }
        };
        recognitionRef.current = recognition;
      }
      startRecognition();
    }, 200); // 200ms 防抖

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      stopRecognition();
    };
  }, [micOn, handleMicToggle, startRecognition, stopRecognition]);

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
          if (containsEndWord(message.text) && micOn) {
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

  function containsWakeWord(text: string) {
    return WAKE_WORDS.some(word => text.includes(word));
  }

  function containsEndWord(text: string) {
    return END_WORDS.some(word => text.includes(word));
  }

  // 录制音频
  function recordAudio(seconds: number): Promise<Blob> {
    return new Promise(async (resolve, reject) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        const chunks: BlobPart[] = [];

        mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
        mediaRecorder.onstop = () => {
          stream.getTracks().forEach(track => track.stop());
          resolve(new Blob(chunks, { type: 'audio/webm' }));
        };
        mediaRecorder.onerror = (err) => reject(err);

        mediaRecorder.start();
        setTimeout(() => mediaRecorder.stop(), seconds * 1000);
      } catch (err) {
        reject(err);
      }
    });
  }

  // 将 WebM 转换为 WAV
  async function convertToWav(audioBlob: Blob): Promise<Blob> {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // 创建 WAV 文件
    const wavBuffer = audioBufferToWav(audioBuffer);
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  // 将 AudioBuffer 转换为 WAV 格式
  function audioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length * numChannels * 2 + 44; // 16-bit PCM
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);

    // 写入 WAV 头部
    const writeString = (view: DataView, offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    // WAV 头部
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + audioBuffer.length * numChannels * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * numChannels * 2, true); // ByteRate
    view.setUint16(32, numChannels * 2, true); // BlockAlign
    view.setUint16(34, 16, true); // BitsPerSample
    writeString(view, 36, 'data');
    view.setUint32(40, audioBuffer.length * numChannels * 2, true);

    // 写入 PCM 数据
    let offset = 44;
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = audioBuffer.getChannelData(channel)[i];
        const value = Math.max(-1, Math.min(1, sample)) * 0x7FFF; // 转换为 16-bit PCM
        view.setInt16(offset, value, true);
        offset += 2;
      }
    }

    return buffer;
  }

  // 调用 Whisper API 进行转录
  async function transcribeWithWhisper(audioBlob: Blob): Promise<string> {
    try {
      // 将 WebM 转换为 WAV
      const wavBlob = await convertToWav(audioBlob);

      const formData = new FormData();
      formData.append('file', wavBlob, 'audio.wav'); // 使用 WAV 格式
      formData.append('model', WHISPER_MODEL);

      const response = await fetch(WHISPER_API_URL, {
        method: 'POST',
        body: formData,
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Whisper API 错误:', response.status, errorText);
        throw new Error(`Whisper API 请求失败: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      return result.text || '';
    } catch (err) {
      console.error('转录错误:', err);
      throw err;
    }
  }

  let isBackgroundListening = false;
  function startBackgroundWakeWordListening(onWake: () => void) {
    isBackgroundListening = true;
    (async function loop() {
      while (isBackgroundListening) {
        try {
          const audioBlob = await recordAudio(RECORD_SECONDS);
          const wavBlob = await convertToWav(audioBlob); // 转换为 WAV
          const text = await transcribeWithWhisper(wavBlob);
          console.log('后台识别到:', text);
          if (containsWakeWord(text)) {
            isBackgroundListening = false;
            onWake();
            break;
          }
        } catch (err) {
          console.error('后台监听录音或识别出错:', err);
          await new Promise(res => setTimeout(res, 1000));
        }
        await new Promise(res => setTimeout(res, 500));
      }
    })();
  }

  function stopBackgroundWakeWordListening() {
    isBackgroundListening = false;
  }

  useEffect(() => {
    if (!micOn) {
      startBackgroundWakeWordListening(() => {
        // 检测到唤醒词，自动开麦
        handleMicToggle();
      });
    } else {
      stopBackgroundWakeWordListening();
    }
    return () => stopBackgroundWakeWordListening();
  }, [micOn, handleMicToggle]);

  return (
    <WebSocketContext.Provider value={webSocketContextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

export default WebSocketHandler;
