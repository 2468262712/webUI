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
  const { aiState, setAiState, setBackendSynthComplete } = useAiState();
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
  const isStartingRef = useRef(false);
  const WAKE_WORDS = ['你好，小薇', '小薇你好', '开始对话', '你好小微','继续对话','你好，小位','你好小位','你好，小微'];
  const END_WORDS = ['结束对话', '关闭对话', '停止对话', '请结束对话','再见','退出对话'];
  const API_URL = "https://fastbase.csic.cn/v1/audio/transcriptions";
  const MODEL_NAME = "whisper-large-v3-turbo";
  const API_KEY = "sk-S9pbSD2Nd3e8NJHVuUBWaBpUG6Kqx6jkemYnlrpkPy7ffVsK";
  const RECORD_SECONDS = 3;

  // 1. 移除 isWebSpeechSupported 检查，强制 useWebSpeech 初始值为 true
  // 2. 修改相关 useEffect 逻辑

  // 新增状态变量
  const [webSpeechFailCount, setWebSpeechFailCount] = useState(0);
  const webSpeechFailCountRef = useRef(0);
  // 新增：强制 useWebSpeech 初始值为 true
  const [useWebSpeech, setUseWebSpeech] = useState(true);

  // Refs for latest values
  const handleMicToggleRef = useRef(handleMicToggle);
  const micOnRef = useRef(micOn);
  useEffect(() => {
    handleMicToggleRef.current = handleMicToggle;
  }, [handleMicToggle]);
  useEffect(() => {
    micOnRef.current = micOn;
  }, [micOn]);

  // 修改 Web Speech API 初始化逻辑，不再判断 isWebSpeechSupported
  useEffect(() => {
    if (!recognitionRef.current) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        // 浏览器不支持，直接切 Whisper
        setUseWebSpeech(false);
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.lang = 'zh-CN';
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onstart = () => {
        recognitionActiveRef.current = true;
        console.log('Web Speech API 识别开始');
      };
      recognition.onresult = (event: any) => {
        const last = event.results.length - 1;
        const transcript = event.results[last][0].transcript.trim();
        console.log('Web Speech API 检测到文本:', transcript);
        if (WAKE_WORDS.some(word => transcript.includes(word)) && !micOnRef.current) {
          console.log('Web Speech API 检测到唤醒词，正在打开麦克风');
          handleMicToggleRef.current();
        }
      };
      recognition.onerror = (event: any) => {
        console.error('Web Speech API 出现错误:', event.error);
        if (event.error === 'not-allowed') {
          toaster.create({
            title: '麦克风权限被拒绝，语音唤醒功能无法使用。',
            type: 'error',
            duration: 2000,
          });
        }
        if (!micOnRef.current) {
          webSpeechFailCountRef.current += 1;
          setWebSpeechFailCount(webSpeechFailCountRef.current);
          setTimeout(() => {
            if (webSpeechFailCountRef.current < 5) {
              startRecognition();
              console.log('Web Speech API 识别服务因错误已重启。');
            } else {
              console.log('Web Speech API 失败次数过多，不再重启，切换为 Whisper API');
              setUseWebSpeech(false); // 失败次数过多，切换为 Whisper
            }
          }, 5000);
        }
      };
      recognition.onend = () => {
        recognitionActiveRef.current = false;
        if (!micOnRef.current) {
          webSpeechFailCountRef.current += 1;
          setWebSpeechFailCount(webSpeechFailCountRef.current);
          setTimeout(() => {
            if (webSpeechFailCountRef.current < 5) {
              startRecognition();
              console.log('Web Speech API 识别服务已重启。');
            } else {
              console.log('Web Speech API 失败次数过多，不再重启，切换为 Whisper API');
              setUseWebSpeech(false); // 失败次数过多，切换为 Whisper
            }
          }, 5000);
        }
      };
      recognitionRef.current = recognition;
    }
  }, []); // 只在挂载时执行

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
        console.log('Web Speech API 识别开始');
      } catch (e) {
        if ((e as any).name === 'InvalidStateError') {
          // Already running
        } else {
          console.error('启动 Web Speech API 失败: ', e);
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

  // Start/Stop logic based on micOn and support
  useEffect(() => {
    if (!micOn) {
      if (useWebSpeech && recognitionRef.current) {
        startRecognition();
      } else {
        startBackgroundWakeWordListening(() => {
          console.log('Whisper API 检测到唤醒词，正在打开麦克风');
          handleMicToggleRef.current();
        });
      }
    } else {
      stopRecognition();
      stopBackgroundWakeWordListening();
    }
    return () => {
      stopRecognition();
      stopBackgroundWakeWordListening();
    };
  }, [micOn, useWebSpeech]);

  useEffect(() => {
    autoStartMicOnConvEndRef.current = autoStartMicOnConvEnd;
  }, [autoStartMicOnConvEnd]);

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
        console.log('正在启动麦克风...');
        startMic();
        break;
      case 'stop-mic':
        console.log('正在关闭麦克风...');
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
        console.warn('未知的控制命令:', controlText);
    }
  }, [setAiState, clearResponse, setForceNewMessage, startMic, stopMic]);

  const handleWebSocketMessage = useCallback((message: MessageEvent) => {
    console.log('收到服务器消息:', message);

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
          console.log('配置UID:', message.conf_uid);
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
          console.log('音频播放被拦截。文本:', message.display_text?.text);
        } else {
          console.log('动作信息:', message.actions);
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
        console.log('用户输入转录:', message.text);
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
        console.log('收到群组更新:', message.members);
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
        console.warn(`未知的消息类型: ${message.type}`);
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

  async function convertToWav(audioBlob: Blob): Promise<Blob> {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const wavBuffer = audioBufferToWav(audioBuffer);
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  function audioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length * numChannels * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);

    const writeString = (view: DataView, offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + audioBuffer.length * numChannels * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, audioBuffer.length * numChannels * 2, true);

    let offset = 44;
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = audioBuffer.getChannelData(channel)[i];
        const value = Math.max(-1, Math.min(1, sample)) * 0x7FFF;
        view.setInt16(offset, value, true);
        offset += 2;
      }
    }

    return buffer;
  }

  async function transcribeWithWhisper(audioBlob: Blob): Promise<string> {
    try {
      const wavBlob = await convertToWav(audioBlob);

      const formData = new FormData();
      formData.append('file', wavBlob, 'audio.wav');
      formData.append('model', MODEL_NAME);
      formData.append('language', 'zh');

      const response = await fetch(API_URL, {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Whisper API 出现错误:', response.status, errorText);
        throw new Error(`Whisper API 请求失败: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      return result.text || '';
    } catch (err) {
      console.error('转录时发生错误:', err);
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
          const wavBlob = await convertToWav(audioBlob);
          const text = await transcribeWithWhisper(wavBlob);
          console.log('Whisper API 检测到文本:', text);
          if (containsWakeWord(text)) {
            isBackgroundListening = false;
            onWake();
            break;
          }
        } catch (err) {
          console.error('Whisper API 发生错误:', err);
          await new Promise(res => setTimeout(res, 1000));
        }
        await new Promise(res => setTimeout(res, 500));
      }
    })();
  }

  function stopBackgroundWakeWordListening() {
    isBackgroundListening = false;
  }

  return (
    <WebSocketContext.Provider value={webSocketContextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

export default WebSocketHandler;