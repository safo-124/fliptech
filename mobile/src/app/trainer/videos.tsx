import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import { Check, CircleCheck, FolderOpen, Images, Pause, ShieldCheck, Trash2, Upload, Video } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, FormError } from "@/components/Form";
import { StackHeader } from "@/components/StackHeader";
import { ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { mediaUrl } from "@/lib/media";
import { useOnline } from "@/lib/online";
import { openOnSite } from "@/lib/open";
import {
  discardCopiesExcept,
  discardCopy,
  forgetFile,
  forgetFilesExcept,
  openVideo,
  pickFromFiles,
  pickFromGallery,
  rememberFile,
  rememberedFiles,
  sendVideoPiece,
  trainerVideos,
  type PickedVideo,
  type RememberedFiles,
  type TrainerVideo,
  type TrainerVideoLimits,
  type TrainerVideoList,
  type TrainerVideoStatus,
} from "@/lib/trainer-videos";
import { UploadPaused, formatBytes, isVideoFile, percentSent, sameFile, sendFile } from "@/lib/video-upload";
import { colors, fonts, radius, space } from "@/theme/tokens";

const BRAND = "Fliiptech";

/**
 * The website's words (frontend/messages/en.json, TrainerVideos), so a
 * trainer reads the same thing on either. Where the website says "this
 * page", the app says "this screen".
 */
const T = {
  lead: "A few minutes of you teaching shows a trainee what they will learn better than any photograph, and a whole course can go up lesson by lesson. Choose a video from your phone and it is sent from here.",
  // Whether a video shows before or after our team has watched it: the
  // server's switch, and review-first again for a trainer with two removed.
  publishesStraightAway:
    "Your videos go on your listing as soon as they are ready. Our team watches them afterwards and removes any that break the guidelines.",
  reviewFirstBecauseBlocked: "Two of your videos were removed, so our team now watches each new video before it shows.",
  reviewFirst: "Our team watches each video before it shows on your listing.",
  tipsTitle: "Before you film",
  tips: (minutes: number) => [
    `One lesson per video, up to ${minutes} minutes. Split a longer course into lessons.`,
    "Set your camera to 720p. The video is smaller to send and looks the same on a phone.",
    "Film in daylight, with the phone held sideways.",
    "Show your own teaching, not videos made by someone else.",
    "Ask anyone you film before you send it, and leave children out unless a parent agrees.",
    "A long lesson uses a lot of data to send. Use Wi-Fi if you can, and keep the app open on this screen until it finishes.",
  ],
  notAccepting: `Videos cannot be uploaded right now. Your other videos are safe. Try again tomorrow, or contact ${BRAND}.`,
  full: "Your listing has as many videos as it can hold. Remove one to add another.",
  noListing: "Create your workshop details before adding videos.",
  fileLabel: "Video",
  fromGallery: "Choose from gallery",
  fromFiles: "Choose from files",
  gettingReady: "Getting the video ready…",
  chooseAnother: "Choose another",
  chosen: (size: string) => `Video chosen · ${size}`,
  couldNotOpen: "That video could not be opened. Choose another.",
  // The gallery copies the video onto the phone first; the file picker does not.
  galleryFailed: "That video could not be opened. If your phone is nearly full, use Choose from files instead.",
  galleryDenied: `Allow ${BRAND} to see your videos in your phone's settings, or use Choose from files.`,
  agree: "This is my own video, everyone in it agreed to be filmed, and no child appears without a guardian.",
  agreeRequired: "Tick the box to confirm this video follows the guidelines.",
  fileHelp: (size: string) => `Up to ${size} per lesson.`,
  titleLabel: "What it shows",
  titlePlaceholder: "Lesson 1: Cornrows for beginners",
  add: "Send video",
  adding: "Starting…",
  fileRequired: "Choose a video from your phone.",
  titleRequired: "Say what the video shows.",
  notAVideo: "That file is not a video. Choose a video from your phone or camera.",
  tooLarge: (size: string, max: string) =>
    `That video is ${size}. Each lesson can be up to ${max}: film at 720p, or split it into shorter lessons.`,
  addFailed: "That video could not be started. Check your connection and try again.",
  removeFailed: "That video could not be removed. Try again.",
  loadFailed: "Your videos could not be loaded. Check your connection and try again.",
  empty: `No videos yet. Once ${BRAND} has watched one you send, trainees can play it on your listing.`,
  emptyStraightAway: "No videos yet. Once one you send is ready, trainees can play it on your listing.",
  count: (count: number, max: number, used: string, hours: number) =>
    `${count} ${count === 1 ? "video" : "videos"} of ${max} · ${used} of ${hours} hours used.`,
  notLive: "Your videos show once your listing is live.",
  status: {
    uploading: "Sending",
    queued: "Waiting to be prepared",
    processing: "Being prepared",
    failed: "Could not be prepared",
    pending: "Waiting for review",
    approved: "On your listing",
    rejected: "Removed by our team",
  } satisfies Record<TrainerVideoStatus, string>,
  statusNote: {
    uploading: "Keep this screen open while it sends.",
    queued: `It has arrived. ${BRAND} is preparing it so it plays well on phones.`,
    processing: `${BRAND} is preparing it so it plays well on phones. A long lesson can take a while.`,
    failed: `${BRAND} could not prepare this video. Remove it, and send it again.`,
    pending: `It appears on your listing once ${BRAND} has watched it.`,
    approved: "Trainees can play it on your listing.",
    rejected: "It no longer shows on your listing.",
  } satisfies Record<TrainerVideoStatus, string>,
  progress: (sent: string, total: string, percent: number) => `${sent} of ${total} sent (${percent}%)`,
  paused: "Sending stopped: the connection dropped. Everything sent so far is kept.",
  stopped: "Sending stopped. Everything sent so far is kept.",
  resume: "Carry on sending",
  resumePick: "To carry on sending, choose the same video again.",
  resumeLabel: (name: string) => `Choose “${name}” again`,
  wrongFile: (name: string) => `That is not the same video. Choose “${name}”, or remove this one and start again.`,
  pause: "Pause",
  length: (minutes: number) => `${minutes} ${minutes === 1 ? "minute" : "minutes"}`,
  reviewNote: (note: string) => `Why: ${note}`,
  failureNote: (reason: string) => `What went wrong: ${reason}`,
  remove: "Remove",
  cancel: "Cancel sending",
  removeLabel: (title: string) => `Remove “${title}”`,
};

/** A lesson title in the trainer's own trade, as the example. */
const LESSONS_BY_TRADE: Record<string, string> = {
  welding: "For example: Striking the arc",
  tailoring: "For example: Taking body measurements",
  plumbing: "For example: Fitting a basin tap",
  "auto-mechanics": "For example: Changing engine oil",
  hairdressing: "For example: Cornrows for beginners",
  "electrical-installation": "For example: Wiring a socket",
};

/** Statuses the server moves on by itself, so the screen checks back. */
const MOVING: TrainerVideoStatus[] = ["queued", "processing"];
const POLL_MS = 15_000;
const KEEP_AWAKE = "trainer-video-upload";

type FieldErrors = { file?: string; title?: string; agreed?: string };
type From = "gallery" | "files";

/** The one line above the form on how a new video reaches the listing. */
function publishing(limits: TrainerVideoLimits) {
  if (limits.publishes_straight_away) return T.publishesStraightAway;
  return limits.review_first_because_blocked ? T.reviewFirstBecauseBlocked : T.reviewFirst;
}
/** The upload this screen is sending right now, if any. One at a time: two would share one phone's signal. */
type Sending = { videoId: number; controller: AbortController };
/** Why an upload stopped: the network (carried on by itself when it is back) or the trainer. */
type PauseReason = "network" | "hand";

function without<T>(record: Record<number, T>, id: number): Record<number, T> {
  const rest = { ...record };
  delete rest[id];
  return rest;
}

/**
 * The trainer's teaching videos, and sending a new one from the phone.
 *
 * The same as the website's Videos tab (frontend/src/components/trainer/
 * TrainerVideos.tsx), with the same limits and words: the file goes a piece
 * at a time (lib/video-upload.ts), the server prepares it for 3G phones, and
 * staff watch it (after it shows, or before when the server says so). On top
 * of the website:
 *
 * - The video comes from the gallery, or from the phone's files. A gallery
 *   video is a copy the app deletes when it is done with it.
 * - The file is remembered (lib/trainer-videos.ts), so an upload stopped by
 *   the app closing or the phone restarting carries on with one tap, without
 *   choosing the video again.
 * - An upload the network stopped carries on by itself when the connection
 *   is back, or when the app comes back to the front.
 * - The screen stays on while a video sends, as the website asks the browser.
 */
export default function TrainerVideosScreen() {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const client = useQueryClient();
  const online = useOnline();
  const isTrainer = auth.signedIn && Boolean(auth.roles?.trainer);

  const list = useQuery({
    queryKey: ["trainer-videos"],
    queryFn: trainerVideos.list,
    enabled: isTrainer,
    // While a video is being prepared the server moves it on by itself.
    refetchInterval: (query) =>
      query.state.data?.videos.some((video) => MOVING.includes(video.status)) ? POLL_MS : false,
  });
  const listing = useQuery({ queryKey: ["trainer-listing"], queryFn: trainerVideos.listing, enabled: isTrainer });

  const [picked, setPickedState] = useState<PickedVideo | null>(null);
  // Also kept in a ref, for deleting a gallery copy nobody sent when the screen closes.
  const pickedRef = useRef<PickedVideo | null>(null);
  const [choosing, setChoosing] = useState(false);
  const choosingRef = useRef(false);
  const mounted = useRef(true);
  const [agreed, setAgreed] = useState(false);
  const [title, setTitle] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const [sending, setSending] = useState<Sending | null>(null);
  const sendingRef = useRef<Sending | null>(null);
  const [files, setFiles] = useState<RememberedFiles>({});
  const [paused, setPaused] = useState<Record<number, PauseReason>>({});
  const [resumeErrors, setResumeErrors] = useState<Record<number, string>>({});

  const videos = list.data?.videos ?? null;
  const limits = list.data?.limits ?? null;

  /** The video chosen for the form. `keep` when it became an upload, so its file is still needed. */
  const setPicked = useCallback((next: PickedVideo | null, keep = false) => {
    const before = pickedRef.current;
    if (before && !keep && before.uri !== next?.uri) discardCopy(before.uri);
    pickedRef.current = next;
    setPickedState(next);
  }, []);

  // The files of uploads still arriving; any other is forgotten.
  const arriving = videos
    ?.filter((video) => video.status === "uploading")
    .map((video) => video.id)
    .join(",");
  const tidied = useRef(false);
  useEffect(() => {
    if (arriving === undefined) {
      void rememberedFiles().then(setFiles);
      return;
    }
    void forgetFilesExcept(arriving ? arriving.split(",").map(Number) : []).then((kept) => {
      setFiles(kept);
      // Once a visit: gallery copies the app was closed on before sending.
      // Not while the gallery is writing a new one.
      if (tidied.current || choosingRef.current) return;
      tidied.current = true;
      const keep = Object.values(kept).map((file) => file.uri);
      if (pickedRef.current) keep.push(pickedRef.current.uri);
      discardCopiesExcept(keep);
    });
  }, [arriving]);

  /** Put the server's latest word on a video into the list. `add` for a new one. */
  const replace = useCallback(
    (video: TrainerVideo, add = false) => {
      client.setQueryData<TrainerVideoList>(["trainer-videos"], (current) => {
        if (!current) return current;
        const known = current.videos.some((row) => row.id === video.id);
        if (!known && !add) return current;
        return {
          ...current,
          videos: known ? current.videos.map((row) => (row.id === video.id ? video : row)) : [...current.videos, video],
        };
      });
    },
    [client],
  );

  const send = useCallback(
    async (video: TrainerVideo, uri: string) => {
      const chunkBytes = client.getQueryData<TrainerVideoList>(["trainer-videos"])?.limits.chunk_bytes;
      if (!chunkBytes || sendingRef.current) return;
      let source: ReturnType<typeof openVideo>;
      try {
        source = openVideo(uri);
      } catch {
        // Moved, deleted, cleared from the cache, or the phone no longer lets
        // the app read it. Without its file the card asks for it again.
        setFiles(await forgetFile(video.id));
        setPaused((current) => without(current, video.id));
        setResumeErrors((current) => without(current, video.id));
        return;
      }
      if (!sameFile(video, source.size)) {
        source.close();
        setFiles(await forgetFile(video.id));
        setResumeErrors((current) => ({ ...current, [video.id]: T.wrongFile(video.upload_name || video.title) }));
        return;
      }

      const controller = new AbortController();
      const now = { videoId: video.id, controller };
      sendingRef.current = now;
      setSending(now);
      setPaused((current) => without(current, video.id));
      setResumeErrors((current) => without(current, video.id));
      setError(null);
      // A phone that locks itself sends the app to the back, and the upload
      // with it. Not every phone allows this, and nothing breaks without it.
      await activateKeepAwakeAsync(KEEP_AWAKE).catch(() => undefined);
      try {
        const done = await sendFile(video, source, {
          chunkBytes,
          sendPiece: sendVideoPiece,
          signal: controller.signal,
          onProgress: (received) => replace({ ...video, upload_received: received }),
        });
        replace(done);
        setFiles(await forgetFile(video.id));
      } catch (reason) {
        if (reason instanceof UploadPaused) {
          replace({ ...video, upload_received: reason.received });
          setPaused((current) => ({ ...current, [video.id]: controller.signal.aborted ? "hand" : "network" }));
        } else {
          setError(reason instanceof Error ? reason.message : T.addFailed);
          void list.refetch();
        }
      } finally {
        source.close();
        void deactivateKeepAwake(KEEP_AWAKE).catch(() => undefined);
        sendingRef.current = null;
        setSending(null);
      }
    },
    [client, list, replace],
  );

  // An upload the network stopped carries on by itself once it can: when the
  // phone is back online, or the app is back in front. Through a ref, so the
  // listeners below always see the latest state.
  const carryOn = useCallback(() => {
    if (sendingRef.current) return;
    const next = (client.getQueryData<TrainerVideoList>(["trainer-videos"])?.videos ?? []).find(
      (video) => video.status === "uploading" && paused[video.id] === "network" && files[String(video.id)],
    );
    if (next) void send(next, files[String(next.id)].uri);
  }, [client, paused, files, send]);
  const carryOnRef = useRef(carryOn);
  useEffect(() => {
    carryOnRef.current = carryOn;
  }, [carryOn]);
  useEffect(() => {
    if (online) carryOnRef.current();
  }, [online]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") carryOnRef.current();
    });
    return () => subscription.remove();
  }, []);

  // Leaving the screen stops sending; what was sent is kept, and the file is
  // remembered for "Carry on sending". A gallery copy chosen but never sent
  // is deleted.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sendingRef.current?.controller.abort();
      discardCopy(pickedRef.current?.uri);
    };
  }, []);

  /** A video from the gallery or the files. Null when the trainer backs out; the error is shown here. */
  async function pick(from: From, showError: (message: string) => void): Promise<PickedVideo | null> {
    choosingRef.current = true;
    setChoosing(true);
    let chosen: PickedVideo | "denied" | null;
    try {
      chosen = from === "gallery" ? await pickFromGallery() : await pickFromFiles();
    } catch {
      showError(from === "gallery" ? T.galleryFailed : T.couldNotOpen);
      return null;
    } finally {
      choosingRef.current = false;
      setChoosing(false);
    }
    if (chosen === "denied") {
      showError(T.galleryDenied);
      return null;
    }
    if (chosen && !mounted.current) {
      // The screen closed while the gallery was copying it.
      discardCopy(chosen.uri);
      return null;
    }
    return chosen;
  }

  async function choose(from: From) {
    const chosen = await pick(from, (message) => setFieldErrors((current) => ({ ...current, file: message })));
    if (!chosen) return;
    setPicked(chosen);
    // Checked as soon as it is chosen, and the old message goes once the file is right.
    setFieldErrors((current) => ({ ...current, file: isVideoFile(chosen.type, chosen.name) ? undefined : T.notAVideo }));
  }

  async function add() {
    if (!limits) return;
    const missing: FieldErrors = {
      file: picked ? undefined : T.fileRequired,
      title: title.trim() ? undefined : T.titleRequired,
      agreed: agreed ? undefined : T.agreeRequired,
    };
    if (picked && !isVideoFile(picked.type, picked.name)) {
      missing.file = T.notAVideo;
    } else if (picked && picked.size > limits.max_upload_bytes) {
      missing.file = T.tooLarge(formatBytes(picked.size), formatBytes(limits.max_upload_bytes));
    }
    setFieldErrors(missing);
    if (missing.file || missing.title || missing.agreed || !picked) return;

    setStarting(true);
    setError(null);
    let video: TrainerVideo;
    try {
      video = await trainerVideos.start(title.trim(), picked, agreed);
    } catch (reason) {
      const fields = reason instanceof ApiError ? reason.fields : {};
      if (fields.title || fields.name || fields.agreed_to_guidelines) {
        setFieldErrors({ title: fields.title, file: fields.name, agreed: fields.agreed_to_guidelines });
      } else setError(reason instanceof Error ? reason.message : T.addFailed);
      return;
    } finally {
      setStarting(false);
    }
    // Remembered before it shows, so it is never shown without its file.
    setFiles(await rememberFile(video.id, picked.uri, picked.size));
    replace(video, true);
    setPicked(null, true);
    setTitle("");
    // Each video gets its own word that it follows the guidelines.
    setAgreed(false);
    await send(video, picked.uri);
  }

  async function resume(video: TrainerVideo, from: From = "gallery") {
    const remembered = files[String(video.id)];
    if (remembered) {
      void send(video, remembered.uri);
      return;
    }
    // The file is no longer known (or the phone cleared the gallery copy):
    // the trainer picks it again, and only the part not yet sent goes.
    const chosen = await pick(from, (message) => setResumeErrors((current) => ({ ...current, [video.id]: message })));
    if (!chosen) return;
    if (!sameFile(video, chosen.size)) {
      discardCopy(chosen.uri);
      setResumeErrors((current) => ({ ...current, [video.id]: T.wrongFile(video.upload_name || video.title) }));
      return;
    }
    setFiles(await rememberFile(video.id, chosen.uri, chosen.size));
    void send(video, chosen.uri);
  }

  function confirmRemove(video: TrainerVideo) {
    const arrivingNow = video.status === "uploading";
    Alert.alert(
      arrivingNow ? "Cancel sending?" : "Remove this video?",
      arrivingNow ? "What has been sent so far is deleted." : "It comes off your listing.",
      [
        { text: "Keep it", style: "cancel" },
        { text: arrivingNow ? T.cancel : T.remove, style: "destructive", onPress: () => void remove(video.id) },
      ],
    );
  }

  async function remove(videoId: number) {
    if (sendingRef.current?.videoId === videoId) sendingRef.current.controller.abort();
    setRemoving(videoId);
    setError(null);
    try {
      await trainerVideos.remove(videoId);
      client.setQueryData<TrainerVideoList>(["trainer-videos"], (current) =>
        current ? { ...current, videos: current.videos.filter((video) => video.id !== videoId) } : current,
      );
      setFiles(await forgetFile(videoId));
      void list.refetch();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : T.removeFailed);
    } finally {
      setRemoving(null);
    }
  }

  if (!auth.signedIn || !auth.roles?.trainer) {
    return (
      <View style={styles.screen}>
        <StackHeader eyebrow="MY WORKSHOP" title="Teaching videos" />
        <View style={[styles.card, { margin: space.lg, gap: space.md }]}>
          {!auth.signedIn ? (
            <>
              <Text variant="body">Sign in with the phone number of your workshop to add teaching videos.</Text>
              <Button
                label="Sign in"
                onPress={() => router.push({ pathname: "/sign-in", params: { why: "to add teaching videos" } })}
              />
            </>
          ) : (
            <>
              <Text variant="body">Teaching videos are for trainers with a workshop on {BRAND}.</Text>
              <Button label="Teach a course or list your workshop" tone="soft" onPress={() => void openOnSite("/join")} />
            </>
          )}
        </View>
      </View>
    );
  }

  const noListing = listing.data?.authenticated === true && listing.data.profile === null;
  const listingLive = listing.data?.profile?.status === "published";
  const tradeSlug = listing.data?.profile?.programme?.trade?.slug;
  const full =
    limits !== null &&
    videos !== null &&
    (videos.length >= limits.max_videos || limits.seconds_used >= limits.max_hours * 3600);

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow="MY WORKSHOP" title="Teaching videos" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xl }}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && sending === null}
            onRefresh={() => {
              void list.refetch();
              void listing.refetch();
            }}
            tintColor={colors.brand}
          />
        }
      >
        <View style={[styles.card, { gap: space.lg }]}>
          <View style={styles.intro}>
            <View style={styles.introIcon}>
              <Video size={18} color={colors.brandStrong} />
            </View>
            <Text variant="small" style={{ flex: 1, color: colors.foreground, lineHeight: 20 }}>
              {T.lead}
            </Text>
          </View>

          <View style={styles.tips}>
            <Text variant="label">{T.tipsTitle}</Text>
            {T.tips(limits?.max_minutes ?? 60).map((tip) => (
              <View key={tip} style={styles.tip}>
                <CircleCheck size={16} color={colors.visit} style={{ marginTop: 2 }} />
                <Text variant="small" style={{ flex: 1 }}>
                  {tip}
                </Text>
              </View>
            ))}
          </View>

          {limits && limits.accepting !== false && !noListing ? (
            <View style={styles.publishing}>
              <ShieldCheck size={16} color={colors.brandStrong} style={{ marginTop: 2 }} />
              <Text variant="small" style={{ flex: 1, color: colors.foreground }}>
                {publishing(limits)}
              </Text>
            </View>
          ) : null}

          {limits === null ? null : limits.accepting === false ? (
            // The server has no room for uploads right now: say so instead of
            // a form that would refuse after the trainer has filled it.
            <View style={styles.warn} accessibilityRole="alert">
              <Text style={styles.warnText}>{T.notAccepting}</Text>
            </View>
          ) : noListing ? (
            <View style={{ gap: space.md }}>
              <Text variant="body">{T.noListing}</Text>
              <Button label="Open my workshop" tone="soft" onPress={() => void openOnSite("/trainer/dashboard")} />
            </View>
          ) : full ? (
            <Text variant="small">{T.full}</Text>
          ) : (
            <View style={{ gap: space.lg }}>
              <View style={{ gap: 6 }}>
                <Text variant="label">{T.fileLabel}</Text>
                <Pressable
                  onPress={() => void choose("gallery")}
                  disabled={starting || choosing}
                  accessibilityRole="button"
                  accessibilityState={{ busy: choosing }}
                  style={({ pressed }) => [
                    styles.picker,
                    fieldErrors.file ? styles.pickerError : null,
                    pressed ? { opacity: 0.85 } : null,
                  ]}
                >
                  {choosing ? <ActivityIndicator color={colors.brand} /> : <Images size={18} color={colors.brand} />}
                  <Text style={styles.pickerText} numberOfLines={1}>
                    {choosing ? T.gettingReady : picked ? T.chosen(formatBytes(picked.size)) : T.fromGallery}
                  </Text>
                  {picked && !choosing ? <Text style={styles.pickerLink}>{T.chooseAnother}</Text> : null}
                </Pressable>
                <Pressable
                  onPress={() => void choose("files")}
                  disabled={starting || choosing}
                  accessibilityRole="button"
                  hitSlop={6}
                  style={({ pressed }) => [styles.filesLink, pressed ? { opacity: 0.6 } : null]}
                >
                  <FolderOpen size={16} color={colors.brand} />
                  <Text style={styles.filesLinkText}>{T.fromFiles}</Text>
                </Pressable>
                {fieldErrors.file ? (
                  <Text variant="small" style={{ color: colors.destructive }} accessibilityLiveRegion="polite">
                    {fieldErrors.file}
                  </Text>
                ) : (
                  <Text variant="small">{T.fileHelp(formatBytes(limits.max_upload_bytes))}</Text>
                )}
              </View>
              <Field
                label={T.titleLabel}
                value={title}
                maxLength={100}
                onChangeText={(text) => {
                  setTitle(text);
                  if (text.trim()) setFieldErrors((current) => ({ ...current, title: undefined }));
                }}
                placeholder={(tradeSlug && LESSONS_BY_TRADE[tradeSlug]) || T.titlePlaceholder}
                error={fieldErrors.title}
                returnKeyType="done"
              />
              <View style={{ gap: 6 }}>
                <Pressable
                  onPress={() => {
                    setAgreed(!agreed);
                    if (!agreed) setFieldErrors((current) => ({ ...current, agreed: undefined }));
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: agreed }}
                  accessibilityLabel={T.agree}
                  style={styles.agree}
                >
                  <View style={[styles.box, agreed ? styles.boxOn : null, fieldErrors.agreed ? styles.boxError : null]}>
                    {agreed ? <Check size={16} color="#fff" strokeWidth={3} /> : null}
                  </View>
                  <Text variant="small" style={{ flex: 1, color: colors.foreground }}>
                    {T.agree}
                  </Text>
                </Pressable>
                {fieldErrors.agreed ? (
                  <Text variant="small" style={{ color: colors.destructive }} accessibilityLiveRegion="polite">
                    {fieldErrors.agreed}
                  </Text>
                ) : null}
              </View>
              <Button
                label={starting ? T.adding : T.add}
                busy={starting}
                // One upload at a time: two would share one phone's signal and both would crawl.
                disabled={sending !== null}
                icon={<Upload size={18} color="#fff" />}
                onPress={() => void add()}
              />
            </View>
          )}

          <FormError message={error} />
        </View>

        {list.isError && !list.data ? (
          <ErrorState message={T.loadFailed} onRetry={() => void list.refetch()} />
        ) : videos === null || limits === null ? (
          <View style={{ gap: space.md }} accessibilityLabel="Loading your videos…">
            <Skeleton style={{ height: 180 }} />
            <Skeleton style={{ height: 180 }} />
          </View>
        ) : videos.length === 0 ? (
          <View style={styles.empty}>
            <Text variant="small" style={{ textAlign: "center" }}>
              {limits.publishes_straight_away ? T.emptyStraightAway : T.empty}
            </Text>
          </View>
        ) : (
          <View style={{ gap: space.md }}>
            <Text variant="small" accessibilityLiveRegion="polite">
              {T.count(videos.length, limits.max_videos, (limits.seconds_used / 3600).toFixed(1), limits.max_hours)}
              {listingLive || listing.data === undefined ? "" : ` ${T.notLive}`}
            </Text>
            {videos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                isSending={sending?.videoId === video.id}
                busy={sending !== null}
                hasFile={Boolean(files[String(video.id)])}
                pausedBy={paused[video.id]}
                resumeError={resumeErrors[video.id]}
                removing={removing === video.id}
                onPause={() => sending?.controller.abort()}
                onResume={() => void resume(video)}
                onResumeFromFiles={() => void resume(video, "files")}
                onRemove={() => confirmRemove(video)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function VideoCard({
  video,
  isSending,
  busy,
  hasFile,
  pausedBy,
  resumeError,
  removing,
  onPause,
  onResume,
  onResumeFromFiles,
  onRemove,
}: {
  video: TrainerVideo;
  isSending: boolean;
  busy: boolean;
  hasFile: boolean;
  pausedBy: PauseReason | undefined;
  resumeError: string | undefined;
  removing: boolean;
  onPause: () => void;
  onResume: () => void;
  onResumeFromFiles: () => void;
  onRemove: () => void;
}) {
  const still =
    video.kind === "youtube" && video.youtube_id
      ? `https://i.ytimg.com/vi/${video.youtube_id}/hqdefault.jpg`
      : mediaUrl(video.poster);
  const total = video.upload_size ?? 0;
  const percent = percentSent(video.upload_received, total);
  const uploading = video.status === "uploading";
  const warn = video.status === "failed" || video.status === "rejected";
  const on = video.status === "approved";

  let note = T.statusNote[video.status];
  if (video.status === "rejected" && video.review_note) note = T.reviewNote(video.review_note);
  else if (video.status === "failed" && video.failure_reason) note = T.failureNote(video.failure_reason);
  else if (uploading && !isSending) {
    note = pausedBy === "network" ? T.paused : hasFile ? T.stopped : T.resumePick;
  }

  return (
    <View style={styles.videoCard}>
      <View style={styles.still}>
        {still ? (
          <Image source={still} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        ) : MOVING.includes(video.status) ? (
          <ActivityIndicator color="rgba(255,255,255,0.7)" />
        ) : (
          <Video size={30} color="rgba(255,255,255,0.7)" />
        )}
      </View>
      <View style={{ padding: space.lg, gap: space.sm }}>
        <View style={[styles.badge, warn ? styles.badgeWarn : null, on ? styles.badgeOn : null]}>
          <Text style={[styles.badgeText, warn ? { color: colors.warn } : null, on ? { color: "#fff" } : null]}>
            {T.status[video.status]}
          </Text>
        </View>
        <Text variant="heading">{video.title}</Text>
        {video.duration_seconds ? (
          <Text variant="small">{T.length(Math.max(1, Math.round(video.duration_seconds / 60)))}</Text>
        ) : null}
        {uploading ? (
          <View style={{ gap: 6 }}>
            <View
              style={styles.bar}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: percent }}
            >
              <View style={[styles.barFill, { width: `${percent}%` }]} />
            </View>
            <Text variant="small" accessibilityLiveRegion="polite">
              {T.progress(formatBytes(video.upload_received), formatBytes(total), percent)}
            </Text>
          </View>
        ) : null}
        <Text variant="small">{note}</Text>
        {resumeError ? (
          <Text variant="small" style={{ color: colors.destructive }}>
            {resumeError}
          </Text>
        ) : null}
        <View style={styles.actions}>
          {uploading && isSending ? (
            <Button
              label={T.pause}
              tone="outline"
              onPress={onPause}
              icon={<Pause size={16} color={colors.brand} />}
              style={styles.small}
            />
          ) : null}
          {uploading && !isSending ? (
            <Button
              label={hasFile ? T.resume : T.resumeLabel(video.upload_name || video.title)}
              disabled={busy}
              onPress={onResume}
              icon={<Upload size={16} color="#fff" />}
              style={styles.small}
            />
          ) : null}
          {uploading && !isSending && !hasFile ? (
            <Pressable
              onPress={onResumeFromFiles}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [styles.remove, pressed ? { backgroundColor: colors.muted } : null]}
            >
              <FolderOpen size={16} color={colors.brand} />
              <Text style={styles.filesLinkText}>{T.fromFiles}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onRemove}
            disabled={removing}
            accessibilityRole="button"
            accessibilityLabel={T.removeLabel(video.title)}
            style={({ pressed }) => [styles.remove, pressed ? { backgroundColor: colors.muted } : null]}
          >
            {removing ? (
              <ActivityIndicator color={colors.mutedForeground} />
            ) : (
              <Trash2 size={16} color={colors.mutedForeground} />
            )}
            <Text style={styles.removeText}>{uploading ? T.cancel : T.remove}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  card: {
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  intro: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  introIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandSoft,
  },
  tips: { gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.muted },
  tip: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  warn: { padding: space.md, borderRadius: radius.md, backgroundColor: colors.warnBg },
  warnText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.warn },
  picker: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
  },
  pickerError: { borderColor: colors.destructive },
  pickerText: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.foreground },
  pickerLink: { fontFamily: fonts.bold, fontSize: 14, color: colors.brand },
  filesLink: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, minHeight: 36 },
  filesLinkText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.brand },
  publishing: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  agree: { flexDirection: "row", alignItems: "flex-start", gap: space.md, minHeight: 44 },
  box: {
    width: 24,
    height: 24,
    marginTop: 1,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  boxOn: { borderColor: colors.brand, backgroundColor: colors.brand },
  boxError: { borderColor: colors.destructive },
  empty: {
    padding: space.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
  },
  videoCard: {
    overflow: "hidden",
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  still: { aspectRatio: 16 / 9, alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.muted,
  },
  badgeWarn: { backgroundColor: colors.warnBg },
  badgeOn: { backgroundColor: colors.brand },
  badgeText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.foreground },
  bar: { height: 8, overflow: "hidden", borderRadius: radius.pill, backgroundColor: colors.muted },
  barFill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.brand },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs },
  small: { minHeight: 44, paddingHorizontal: space.lg },
  remove: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  removeText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.mutedForeground },
});
