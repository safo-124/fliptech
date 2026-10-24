"use client";

import { Square, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Reads the listing's key facts aloud: fee, length, start date, the visit and
 * how to find the gate.
 *
 * For someone who reads slowly, or would rather listen. The phone's own voice
 * does the reading (the Web Speech API), so it costs no data and works with
 * no signal. It is shown only when the phone has a voice for the page's
 * language: Twi and Ga have none on phones yet, and a listing read in an
 * English voice would be worse than no button. Recorded audio is how those
 * come later.
 *
 * Nothing renders until the browser has said what voices it has, so the
 * server and the first client render agree.
 */
export function ListenButton({
  script,
  lang,
  labels,
}: {
  script: string;
  lang: string;
  labels: { listen: string; stop: string; hint: string };
}) {
  const [available, setAvailable] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const base = lang.split("-")[0];
    const check = () =>
      setAvailable(window.speechSynthesis.getVoices().some((voice) => voice.lang.startsWith(base)));
    check();
    // Chrome lists its voices only after this fires.
    window.speechSynthesis.addEventListener("voiceschanged", check);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", check);
      window.speechSynthesis.cancel();
    };
  }, [lang]);

  if (!available) return null;

  function toggle() {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const base = lang.split("-")[0];
    const utterance = new SpeechSynthesisUtterance(script);
    utterance.lang = lang;
    utterance.rate = 0.95;
    utterance.voice =
      synth.getVoices().find((voice) => voice.lang === lang) ??
      synth.getVoices().find((voice) => voice.lang.startsWith(base)) ??
      null;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(utterance);
    setSpeaking(true);
  }

  return (
    <Button type="button" variant="outline" onClick={toggle} aria-pressed={speaking} title={labels.hint}>
      {speaking ? <Square aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
      {speaking ? labels.stop : labels.listen}
    </Button>
  );
}
