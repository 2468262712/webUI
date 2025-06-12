/* eslint-disable react/require-default-props */
import { Stack } from '@chakra-ui/react';
import { useEffect } from 'react';
import { settingStyles } from './setting-styles';
import { useASRSettings } from '@/hooks/sidebar/setting/use-asr-settings';
import { SwitchField, NumberField } from './common';

interface ASRProps {
  onSave?: (callback: () => void) => () => void
  onCancel?: (callback: () => void) => () => void
}

function ASR({ onSave, onCancel }: ASRProps): JSX.Element {
  const {
    localSettings,
    autoStopMic,
    autoStartMicOn,
    autoStartMicOnConvEnd,
    setAutoStopMic,
    setAutoStartMicOn,
    setAutoStartMicOnConvEnd,
    handleInputChange,
    handleSave,
    handleCancel,
  } = useASRSettings();

  useEffect(() => {
    if (!onSave || !onCancel) return;

    const cleanupSave = onSave(handleSave);
    const cleanupCancel = onCancel(handleCancel);

    return (): void => {
      cleanupSave?.();
      cleanupCancel?.();
    };
  }, [onSave, onCancel, handleSave, handleCancel]);

  return (
    <Stack {...settingStyles.common.container}>
      <SwitchField
        label="AI开始说话时自动停止麦克风"
        checked={autoStopMic}
        onChange={setAutoStopMic}
      />

      <SwitchField
        label="对话结束时自动开启麦克风"
        checked={autoStartMicOnConvEnd}
        onChange={setAutoStartMicOnConvEnd}
      />

      <SwitchField
        label="AI被打断时自动开启麦克风"
        checked={autoStartMicOn}
        onChange={setAutoStartMicOn}
      />

      <NumberField
        label="语音概率阈值"
        value={localSettings.positiveSpeechThreshold}
        onChange={(value) => handleInputChange('positiveSpeechThreshold', value)}
        min={1}
        max={100}
      />

      <NumberField
        label="负向语音阈值"
        value={localSettings.negativeSpeechThreshold}
        onChange={(value) => handleInputChange('negativeSpeechThreshold', value)}
        min={0}
        max={100}
      />

      <NumberField
        label="补偿帧数"
        value={localSettings.redemptionFrames}
        onChange={(value) => handleInputChange('redemptionFrames', value)}
        min={1}
        max={100}
      />
    </Stack>
  );
}

export default ASR;
