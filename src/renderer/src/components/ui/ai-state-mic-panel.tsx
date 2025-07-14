import { Box, HStack, IconButton } from '@chakra-ui/react';
import AIStateIndicator from '../footer/ai-state-indicator';
import { useMicToggle } from '@/hooks/utils/use-mic-toggle';
import { BsMicFill, BsMicMuteFill } from 'react-icons/bs';
import { footerStyles } from '../footer/footer-styles';

export default function AiStateMicPanel() {
  const { micOn, handleMicToggle } = useMicToggle();

  return (
    <Box>
      <Box mb="1.5">
        <AIStateIndicator />
      </Box>
      <HStack gap={2}>
        <IconButton
          bg={micOn ? 'green.500' : 'red.500'}
          {...footerStyles.footer.actionButton}

          onClick={handleMicToggle}
          aria-label={micOn ? '关闭麦克风' : '开启麦克风'}
        >
          {micOn ? <BsMicFill /> : <BsMicMuteFill />}
        </IconButton>
      </HStack>
    </Box>
  );
} 