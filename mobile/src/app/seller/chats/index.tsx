import { Redirect } from "expo-router";

/** The shop's chats moved into Business messages, with the workshop's. Old links land there. */
export default function SellerChatsMoved() {
  return <Redirect href="/inbox" />;
}
