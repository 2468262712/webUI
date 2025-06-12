import { useMemo, useCallback } from 'react';
import { useWebSocket } from '@/context/websocket-context';

interface WSStatusInfo {
  color: string
  text: string
  isDisconnected: boolean
  handleClick: () => void
}

export const useWSStatus = () => {
  const { wsState, reconnect } = useWebSocket();

  const handleClick = useCallback(() => {
    if (wsState !== 'OPEN' && wsState !== 'CONNECTING') {
      reconnect();
    }
  }, [wsState, reconnect]);

  const statusInfo = useMemo((): WSStatusInfo => {
    switch (wsState) {
      case 'OPEN':
        return {
          color: 'green.500',
          text: ' ',
          isDisconnected: false,
          handleClick,
        };
      case 'CONNECTING':
        return {
          color: 'yellow.500',
          text: '连接中...',
          isDisconnected: false,
          handleClick,
        };
      default:
        return {
          color: 'red.500',
          text: '单击重新连接',
          isDisconnected: true,
          handleClick,
        };
    }
  }, [wsState, handleClick]);

  return statusInfo;
};
