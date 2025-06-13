import { useVAD } from '@/context/vad-context';
import { useAiState, AiStateEnum } from '@/context/ai-state-context';

export function useMicToggle() {
  const { startMic, stopMic, micOn } = useVAD();
  const { aiState, setAiState } = useAiState();

  const handleMicToggle = async (): Promise<void> => {
    if (micOn) {
      stopMic();
      if (aiState === AiStateEnum.LISTENING) {
        setAiState(AiStateEnum.IDLE);
      }
    } else {
      await startMic();
    }
  };

  return {
    handleMicToggle,
    micOn,
  };
}
