import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

/**
 * What the two app stores allow, where they differ.
 *
 * Courses. Apple's App Store Review Guidelines (3.1.1) say an iPhone app that
 * sells digital content, an online course included, must sell it with Apple's
 * own in-app purchase. Fliiptech sells courses with Paystack, so the iPhone
 * app does not sell them: free lessons play, a course the person already owns
 * opens with every lesson, and a paid course shows no price, no buy button and
 * no pointer to buying it somewhere else (which the same rule forbids). A
 * learn-and-buy bundle opens a course too, so it is left out with them.
 *
 * Training at a workshop and things from the shop are used outside the app,
 * and Apple lets those be paid any way (3.1.3(e)), so Paystack stays for them.
 * Android has no such rule.
 */
export function sellsCourses(os: string = Platform.OS) {
  return os !== "ios";
}

/** A learn-and-buy bundle may be sold here unless it opens a course on an iPhone. */
export function sellsBundle(bundle: { includes_course: boolean }, os: string = Platform.OS) {
  return !bundle.includes_course || sellsCourses(os);
}

/**
 * Whether the gallery may be opened. On an iPhone the gallery is Apple's own
 * picker, which hands the app only what the person chooses, so the app asks
 * for no access to the photo library (Apple asks apps not to ask for access
 * they do not need). Android asks, and on Android 13 and later answers yes at
 * once.
 */
export async function mayOpenGallery(os: string = Platform.OS) {
  if (os === "ios") return true;
  return (await ImagePicker.requestMediaLibraryPermissionsAsync()).granted;
}
