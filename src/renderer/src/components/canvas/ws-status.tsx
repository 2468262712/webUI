import { Box } from '@chakra-ui/react';
import React, { memo } from 'react';
import { canvasStyles } from './canvas-styles';
import { useWSStatus } from '@/hooks/canvas/use-ws-status';
import AiStateMicPanel from '../ui/ai-state-mic-panel';

// Type definitions
interface StatusContentProps {
  text: string
}

// Reusable components
const StatusContent: React.FC<StatusContentProps> = ({ text }) => text;
const MemoizedStatusContent = memo(StatusContent);

// Main component
const WebSocketStatus = memo((): JSX.Element => {
  const {
    color, text, handleClick, isDisconnected,
  } = useWSStatus();

  return (
    <>
      {/* 状态提示单独一个Box */}
      <Box
        {...canvasStyles.wsStatus.container}
        bg={color}
        onClick={isDisconnected ? handleClick : undefined}
        style={{
          cursor: isDisconnected ? 'pointer' : 'default',
          opacity: isDisconnected ? 1 : 0.7,
        }}
      >
        <MemoizedStatusContent text={text} />
      </Box>
      {/* 按钮单独一个Box，向下偏移 */}
      <Box position="absolute" top="45px" left="20px" zIndex={2}>
        <AiStateMicPanel />
      </Box>
    </>
  );
});

WebSocketStatus.displayName = 'WebSocketStatus';

export default WebSocketStatus;
