import { Box, Button, IconButton, Input, Text } from "@chakra-ui/react";
import { FiX } from "react-icons/fi";
import {
  DrawerRoot,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
  DrawerFooter,
  DrawerActionTrigger,
  DrawerBackdrop,
  DrawerCloseTrigger,
} from "@/components/ui/drawer";
import { ClipboardButton, ClipboardRoot } from "@/components/ui/clipboard";
import { useGroupDrawer } from "@/hooks/sidebar/use-group-drawer";
import { sidebarStyles } from "./sidebar-styles";
import { useGroup } from "@/context/group-context";

interface GroupDrawerProps {
  children: React.ReactNode;
}

function GroupDrawer({ children }: GroupDrawerProps) {
  const { selfUid, sortedGroupMembers, isOwner } = useGroup();
  const {
    isOpen,
    setIsOpen,
    inviteUid,
    setInviteUid,
    handleInvite,
    handleRemove,
    handleLeaveGroup,
    requestGroupInfo,
  } = useGroupDrawer();

  return (
    <DrawerRoot
      open={isOpen}
      onOpenChange={(e) => {
        setIsOpen(e.open);
        if (e.open) {
          requestGroupInfo();
        }
      }}
      placement="start"
    >
      <DrawerBackdrop />
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent style={sidebarStyles.historyDrawer.drawer.content}>
        <DrawerHeader>
          <DrawerTitle style={sidebarStyles.historyDrawer.drawer.title}>
            群组管理
          </DrawerTitle>
          <DrawerCloseTrigger
            style={sidebarStyles.historyDrawer.drawer.closeButton}
          />
        </DrawerHeader>

        <DrawerBody>
          <Box {...sidebarStyles.historyDrawer.listContainer}>
            <Box {...sidebarStyles.groupDrawer.section}>
              <Text {...sidebarStyles.groupDrawer.sectionTitle}>你的UUID</Text>
              <Box {...sidebarStyles.groupDrawer.memberItem}>
                <Text {...sidebarStyles.groupDrawer.memberText}>{selfUid}</Text>
                <ClipboardRoot value={selfUid}>
                  <ClipboardButton
                    {...sidebarStyles.groupDrawer.clipboardButton}
                    size="sm"
                  />
                </ClipboardRoot>
              </Box>
            </Box>

            <Box {...sidebarStyles.groupDrawer.section}>
              <Text {...sidebarStyles.groupDrawer.sectionTitle}>
                邀请其他客户端成员
              </Text>
              <Box {...sidebarStyles.groupDrawer.inviteBox}>
                <Input
                  value={inviteUid}
                  onChange={(e) => setInviteUid(e.target.value)}
                  placeholder="输入成员UUID"
                  {...sidebarStyles.groupDrawer.input}
                />
                <Button
                  onClick={handleInvite}
                  {...sidebarStyles.groupDrawer.button}
                >
                  邀请
                </Button>
              </Box>
            </Box>

            <Box {...sidebarStyles.groupDrawer.section}>
              <Text {...sidebarStyles.groupDrawer.sectionTitle}>成员列表</Text>
              <Box {...sidebarStyles.groupDrawer.memberList}>
                {sortedGroupMembers.map((memberId) => (
                  <Box key={memberId} {...sidebarStyles.groupDrawer.memberItem}>
                    <Text {...sidebarStyles.groupDrawer.memberText}>
                      {memberId === selfUid ? `${memberId} (你)` : memberId}
                    </Text>
                    {((isOwner && memberId !== selfUid) ||
                      (!isOwner && memberId === selfUid)) && (
                      <IconButton
                        aria-label={memberId === selfUid ? "退出群组" : "移除成员"}
                        onClick={() => (memberId === selfUid
                          ? handleLeaveGroup(selfUid)
                          : handleRemove(memberId))}
                        {...sidebarStyles.groupDrawer.removeButton}
                        size="sm"
                        title={memberId === selfUid ? "退出群组" : "移除成员"}
                      >
                        {memberId === selfUid ? "退出" : <FiX />}
                      </IconButton>
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        </DrawerBody>

        <DrawerFooter>
          <DrawerActionTrigger asChild>
            <Button {...sidebarStyles.historyDrawer.drawer.actionButton}>
              关闭
            </Button>
          </DrawerActionTrigger>
        </DrawerFooter>
      </DrawerContent>
    </DrawerRoot>
  );
}

export default GroupDrawer;
