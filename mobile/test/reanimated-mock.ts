// `react-native-reanimated/mock` in tests: a different file from the
// package's stand-in, so expo-router's mock factory, which requires this
// while mocking the package, does not require itself. See reanimated-impl.ts.
export * from "./reanimated-impl";
export { default } from "./reanimated-impl";
