/**
 * Where the app finds the API.
 *
 * EXPO_PUBLIC_API_URL is read at build time (see .env.example). On a phone
 * on the same Wi-Fi as a laptop running Django, it is the laptop's address,
 * e.g. http://192.168.1.20:8000; on the Android emulator, http://10.0.2.2:8000
 * (the emulator's name for the computer it runs on). In production, the
 * site's own address.
 */
const fallback = "http://10.0.2.2:8000";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? fallback).replace(/\/$/, "");

/**
 * The website, for pages the app does not have yet: a card opens its page
 * there, in an in-app browser, until the app's own screen replaces it.
 */
export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL ?? "http://10.0.2.2:3000").replace(/\/$/, "");
