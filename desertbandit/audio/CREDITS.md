# Audio credits

Every sound the game plays from `desertbandit/audio/` is listed here. Every third-party sound is **CC0 1.0** and has a row below; there is no other third-party audio.
The Wave 1 machine sounds (reel tick, stop, clink, coin, bell, buzz, fanfare) are synthesized in the browser by the game's own code and are not files.

## Third-party files (CC0 only)

These three critters are Desert Ranger's files (`amb/`, linked or copied from the Desert Ranger checkout by `tools/link-game-audio.sh`), credited exactly as in Desert Ranger's `audio/CREDITS.md`.

| file | source page URL | direct file URL | author | license | retrieved (CT) | changes |
|---|---|---|---|---|---|---|
| amb/amb-crow-01.mp3 | https://freesound.org/people/TheKingOfGeeks360/sounds/860982/ | https://cdn.freesound.org/previews/860/860982_15895934-hq.mp3 | TheKingOfGeeks360 (Freesound), "Corvids - American Crow, Single" | CC0 1.0 (license box on the page reads "Creative Commons 0", checked 2026-10-03) | 2026-10-03 | excerpt 0.15-0.75 s of the public hq preview, afftdn noise reduction, fades, mono, -26 LUFS, 64 kbps MP3 |
| amb/amb-coyote-01.mp3 | https://freesound.org/people/Gerent/sounds/558725/ | https://cdn.freesound.org/previews/558/558725_556505-hq.mp3 | Gerent (Freesound), "dogs-howling-yelping-distance-far-04.wav" (tagged coyote; uploader's description: coyotes yipping and howling at night) | CC0 1.0 (license box on the page reads "Creative Commons 0", checked 2026-10-03) | 2026-10-03 | excerpt 0.45-2.30 s of the public hq preview, afftdn noise reduction, fades, mono, -26 LUFS, 64 kbps MP3 |
| amb/amb-hawk-01.mp3 | https://freesound.org/people/craigsmith/sounds/479610/ | https://cdn.freesound.org/previews/479/479610_2524442-hq.mp3 | craigsmith (Freesound), "R30-34-Red Tailed Hawk.wav" | CC0 1.0 (license box on the page reads "Creative Commons 0", checked 2026-10-03) | 2026-10-03 | excerpt 7.40-9.30 s of the public hq preview, afftdn noise reduction, fades, mono, -26 LUFS, 64 kbps MP3 |

## Generated / original

- **Voices (`calls/`, and Desert Ranger's place calls in `radio/places/`):** generated with Chatterbox (model `ResembleAI/chatterbox`, MIT licence). The output carries Resemble's Perth watermark, which is inaudible. The voices are cloned only from Kokoro preset reference voices, never from a real person. All wording in `calls/` is new (`docs/audio-lines.json`, `docs/DESIGN.md` "Originality"): no sampled game, film or meme audio.
- **Reference voices:** Kokoro-82M (Apache-2.0), used only to make the cloning references; no Kokoro audio is shipped.
- **Radio click, squelch and hiss (`radio/fx/`):** original, synthesized with ffmpeg (Desert Ranger's `tools/audio/master.py --fx`). No third-party material.
- **Desert bed and the other critters (`amb/amb-bed-01`, `amb-rattle-01`, `amb-truck-01`, `amb-crickets-01`):** original, synthesized with ffmpeg (Desert Ranger's `tools/audio/make_ambience.py`). No third-party material.
- **Radio treatment of the new lines:** baked in with ffmpeg by `tools/audio/master.py` (band-pass, compression, light overdrive, -16 LUFS).
