import {
  createContext,
  useState,
  ReactNode,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from 'react';

/**
 * AI状态枚举
 * @description 定义了AI可能处于的所有状态
 */
// eslint-disable-next-line no-shadow
export const enum AiStateEnum {
  /**
   * 空闲状态
   * - 可以主动触发说话
   * - 准备接收用户输入
   */
  IDLE = '空闲',

  /**
   * 思考说话状态
   * - 可以被用户打断
   */
  THINKING_SPEAKING = '讲话',

  /**
   * 被打断状态
   * - 由以下情况触发：
   *   - 发送文本
   *   - 检测到语音
   *   - 点击打断按钮
   *   - 创建新的聊天历史
   *   - 切换角色
   */
  INTERRUPTED = '打断',

  /**
   * 加载状态
   * - 在初始加载或切换角色时显示
   */
  LOADING = '加载',

  /**
   * 监听状态
   * - 当检测到语音时触发
   */
  LISTENING = '聆听',

  /**
   * 等待状态
   * - 用户正在输入时设置
   * - 2秒后自动返回空闲状态
   */
  WAITING = '等待',
}

export type AiState = `${AiStateEnum}`;

/**
 * AI状态上下文的类型定义
 */
interface AiStateContextType {
  aiState: AiState;                                    // 当前AI状态
  setAiState: {                                        // 设置AI状态的方法
    (state: AiState): void;
    (updater: (currentState: AiState) => AiState): void;
  };
  backendSynthComplete: boolean;                       // 后端合成是否完成
  setBackendSynthComplete: (complete: boolean) => void; // 设置后端合成状态
  isIdle: boolean;                                     // 是否处于空闲状态
  isThinkingSpeaking: boolean;                         // 是否正在思考说话
  isInterrupted: boolean;                              // 是否被打断
  isLoading: boolean;                                  // 是否正在加载
  isListening: boolean;                                // 是否正在监听
  isWaiting: boolean;                                  // 是否正在等待
  resetState: () => void;                              // 重置状态的方法
}

/**
 * 初始状态值
 */
const initialState: AiState = AiStateEnum.LOADING;

/**
 * 创建AI状态上下文
 */
export const AiStateContext = createContext<AiStateContextType | null>(null);

/**
 * AI状态提供者组件
 * @param children - 子组件
 */
export function AiStateProvider({ children }: { children: ReactNode }) {
  const [aiState, setAiStateInternal] = useState<AiState>(initialState);
  const [backendSynthComplete, setBackendSynthComplete] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 设置AI状态的回调函数
  const setAiState = useCallback((newState: AiState | ((currentState: AiState) => AiState)) => {
    const nextState = typeof newState === 'function'
      ? (newState as (currentState: AiState) => AiState)(aiState)
      : newState;

    // 处理等待状态的特殊逻辑
    if (nextState === AiStateEnum.WAITING) {
      if (aiState !== AiStateEnum.THINKING_SPEAKING) {
        setAiStateInternal(nextState);

        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }

        // 2秒后自动返回空闲状态
        timerRef.current = setTimeout(() => {
          setAiStateInternal(AiStateEnum.IDLE);
          timerRef.current = null;
        }, 2000);
      }
    } else {
      setAiStateInternal(nextState);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [aiState]);

  // 记忆化的状态检查
  const stateChecks = useMemo(
    () => ({
      isIdle: aiState === AiStateEnum.IDLE,
      isThinkingSpeaking: aiState === AiStateEnum.THINKING_SPEAKING,
      isInterrupted: aiState === AiStateEnum.INTERRUPTED,
      isLoading: aiState === AiStateEnum.LOADING,
      isListening: aiState === AiStateEnum.LISTENING,
      isWaiting: aiState === AiStateEnum.WAITING,
    }),
    [aiState],
  );

  // 重置状态的处理函数
  const resetState = useCallback(() => {
    setAiState(AiStateEnum.IDLE);
  }, [setAiState]);

  // 组件卸载时清理定时器
  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  }, []);

  // 记忆化的上下文值
  const contextValue = useMemo(
    () => ({
      aiState,
      setAiState,
      backendSynthComplete,
      setBackendSynthComplete,
      ...stateChecks,
      resetState,
    }),
    [aiState, setAiState, backendSynthComplete, stateChecks, resetState],
  );

  return (
    <AiStateContext.Provider value={contextValue}>
      {children}
    </AiStateContext.Provider>
  );
}

/**
 * 自定义Hook用于使用AI状态上下文
 * @throws {Error} 如果在AiStateProvider外部使用会抛出错误
 */
export function useAiState() {
  const context = useContext(AiStateContext);

  if (!context) {
    throw new Error('useAiState必须在AiStateProvider内部使用');
  }

  return context;
}
