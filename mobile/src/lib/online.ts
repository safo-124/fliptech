import * as Network from "expo-network";

/** False while the phone has no connection (as the offline note says). */
export function useOnline() {
  const network = Network.useNetworkState();
  return !(network.isConnected === false || network.isInternetReachable === false);
}
