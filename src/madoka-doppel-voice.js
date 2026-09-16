import { SpecialSummonIntro } from './special-summon-intro.js?v=special-intro6';

const MADOKA_VOICE_CHUNKS = Object.freeze([
  './assets/audio/doppel/madoka-voice-0a.b64?v=madoka-doppel4',
  './assets/audio/doppel/madoka-voice-0b.b64?v=madoka-doppel4',
  './assets/audio/doppel/madoka-voice-1.b64?v=madoka-doppel4',
  './assets/audio/doppel/madoka-voice-2.b64?v=madoka-doppel4',
  './assets/audio/doppel/madoka-voice-3.b64?v=madoka-doppel4',
  './assets/audio/doppel/madoka-voice-4.b64?v=madoka-doppel4',
]);

const EXPECTED_BASE64_LENGTH = 22788;
const EXPECTED_BYTE_LENGTH = 17090;
let madokaVoiceSourcePromise = null;
let madokaVoiceObjectUrl = null;

function decodeBase64ToBlobUrl(base64) {
  if (base64.length !== EXPECTED_BASE64_LENGTH) {
    throw new Error(`Madoka voice base64 length mismatch: ${base64.length}`);
  }
  const binary = atob(base64);
  if (binary.length !== EXPECTED_BYTE_LENGTH) {
    throw new Error(`Madoka voice byte length mismatch: ${binary.length}`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  madokaVoiceObjectUrl = URL.createObjectURL(blob);
  return madokaVoiceObjectUrl;
}

function loadMadokaVoiceSource() {
  if (madokaVoiceSourcePromise) return madokaVoiceSourcePromise;
  madokaVoiceSourcePromise = Promise.all(
    MADOKA_VOICE_CHUNKS.map(async url => {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
      return (await response.text()).trim();
    }),
  ).then(parts => decodeBase64ToBlobUrl(parts.join('')));
  return madokaVoiceSourcePromise;
}

const originalWaitForVoice = SpecialSummonIntro.prototype._waitForVoice;

SpecialSummonIntro.prototype._waitForVoice = async function patchedWaitForVoice(characterId) {
  if (characterId !== 'madoka') return originalWaitForVoice.call(this, characterId);

  const audio = this.voices?.madoka;
  if (!audio) return false;

  try {
    const src = await loadMadokaVoiceSource();
    if (audio.src !== src) {
      audio.pause();
      audio.src = src;
      audio.load?.();
    }
  } catch (error) {
    // Never fall back to the old truncated madoka.mp3. Silent failure is safer than distorted audio.
    console.error('Failed to load verified Madoka summon voice', error);
    return false;
  }

  return originalWaitForVoice.call(this, characterId);
};
