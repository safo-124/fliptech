import { Redirect, useLocalSearchParams } from "expo-router";

/** One shop chat, now in Business messages. Old links land on the same chat there. */
export default function SellerChatMoved() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: "/inbox/[id]", params: { id } }} />;
}
