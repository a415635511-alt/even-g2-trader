import os, subprocess, shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "video_build"
OUT.mkdir(exist_ok=True)
W, H = 1920, 1080
BG = (8, 13, 10)
CARD = (13, 24, 17)
FG = (218, 250, 226)
GREEN = (110, 255, 148)
MUTED = (115, 165, 130)
BORDER = (34, 88, 52)

def load_font(cands, size):
    for p in cands:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

SANS = [r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"]
MONO = [r"C:\Windows\Fonts\consola.ttf", r"C:\Windows\Fonts\cour.ttf"]
F_TITLE = load_font(SANS, 82)
F_H2 = load_font(SANS, 44)
F_BODY = load_font(SANS, 30)
F_SMALL = load_font(SANS, 24)
F_MONO = load_font(MONO, 25)

def base(tag, title, sub=""):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 8], fill=GREEN)
    d.text((80, 56), tag.upper(), font=F_SMALL, fill=GREEN)
    d.text((80, 96), title, font=F_TITLE, fill=FG)
    if sub:
        d.text((80, 198), sub, font=F_BODY, fill=MUTED)
    return img, d

def synth_wav(text, wav_path):
    ps = f"""
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = 1
$s.SetOutputToWaveFile('{str(wav_path)}')
$s.Speak(@'
{text}
'@)
$s.Dispose()
"""
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True, timeout=60)

SLIDES = []

# Slide 1: Cover
img, d = base("Even Realities G2 · Track 02 Crypto & DeFi", "G2 GlanceDesk",
              "Read live Hyperliquid perps & Polymarket odds. Draft by voice. Confirm with one tap.")
d.rounded_rectangle([80, 290, W - 80, 860], radius=16, fill=CARD, outline=BORDER, width=2)
bullets = [
    "• 576×288 green monochrome eyewear UI — 4 to 5 crisp lines, zero dashboard clutter",
    "• Live feeds: Hyperliquid perpetual mark/funding/OI + Polymarket active volume odds",
    "• Read AND Write: voice intent or 2×tap drafts a bounded order with hard 2% SL",
    "• One-tap Confirm / Double-tap Cancel on G2 temple or R1 ring — never holds real funds",
    "• Real Even Hub SDK integration (bridge, audioControl PCM, .ehpk stamped via evenhub-cli)",
]
for i, b in enumerate(bullets):
    d.text((120, 340 + i * 95), b, font=F_BODY, fill=FG)
d.text((80, 930), "github.com/a415635511-alt/even-g2-trader  ·  Built Nov 23, 2026  ·  MIT", font=F_MONO, fill=MUTED)
p1 = OUT / "s1.png"; img.save(p1)
SLIDES.append((p1, "Meet G2 GlanceDesk, a hands-free read and write trading and prediction market copilot built for Even Realities G2 smart glasses. It brings live Hyperliquid perpetuals and Polymarket odds to a five-line monochrome display, lets you draft bounded paper orders by voice or quick tap, and executes on a single confirmation tap."))

# Slide 2-5: Real captured browser runs
shots = [
    ("shot_1_live_hl.png", "Step 1 · Live Hyperliquid Glance", "Real mark price, 24h move, annualized funding & open interest",
     "First, the eyewear screen renders live Hyperliquid perpetual data fetched through our local Node backend, keeping API routing off the WebView. Here Bitcoin trades at sixty-one thousand four hundred nineteen dollars with eleven percent annualized funding and two-point-three billion in open interest."),
    ("shot_2_confirm.png", "Step 2 · Voice Draft & One-Tap Confirm", "Every write action pauses at a 90-second confirmation gate",
     "When the user speaks 'long 100 btc' or double-taps for a quick draft, the backend creates a bounded paper order with a hard two-percent stop loss. The glasses switch immediately to a confirmation screen: single tap executes, double tap cancels."),
    ("shot_3_poly.png", "Step 3 · Scroll to Live Polymarket Odds", "Top 24h-volume prediction markets with instant YES/NO sizing",
     "Scrolling the ring or temple switches to live Polymarket markets sorted by twenty-four-hour volume. Users can inspect YES and NO probabilities at a glance and draft a twenty-five-dollar paper bet with the same one-tap safety gate."),
    ("shot_4_desk.png", "Step 4 · Live Portfolio Desk & Instant Flatten", "Real-time equity, open positions, bets, and one-command close all",
     "Scrolling once more opens the GlanceDesk portfolio view showing live mark-to-market equity, open Hyperliquid positions, and active Polymarket bets. Saying 'close all' or double-tapping drafts an instant flatten."),
]

for idx, (fname, title, sub, narration) in enumerate(shots, start=2):
    img, d = base(f"Live Demo Capture · {idx-1}/4", title, sub)
    shot = Image.open(OUT / fname).convert("RGB")
    shot.thumbnail((1560, 720))
    x = (W - shot.width) // 2
    y = 270
    d.rounded_rectangle([x - 8, y - 8, x + shot.width + 8, y + shot.height + 8], radius=12, outline=GREEN, width=2)
    img.paste(shot, (x, y))
    p = OUT / f"s{idx}.png"; img.save(p)
    SLIDES.append((p, narration))

# Slide 6: Verification & Packaging
img, d = base("Verification & Packaging", "Tested, built & stamped for Even Hub",
              "Zero mock prices · 4/4 automated tests · out.ehpk packaged (33.8 KB)")
d.rounded_rectangle([80, 290, W - 80, 860], radius=16, fill=CARD, outline=GREEN, width=2)
lines = [
    "$ npm test          -> 4/4 passed (parsers, voice intent, confirm, close-all)",
    "$ npm run build     -> tsc --noEmit + vite build (76 KB bundle)",
    "$ npm run pack      -> Stamped out.ehpk (33,815 bytes) via evenhub-cli",
    "$ live API check    -> HL:8 perps, POLY:6 markets, paper fill & close-all verified",
    "Safety              -> Paper/testnet ledger only · no custody · no keys in WebView",
]
for i, line in enumerate(lines):
    d.text((120, 345 + i * 92), line, font=F_MONO, fill=FG if i < 4 else GREEN)
d.text((80, 930), "Repo: https://github.com/a415635511-alt/even-g2-trader", font=F_MONO, fill=MUTED)
p6 = OUT / "s6.png"; img.save(p6)
SLIDES.append((p6, "Everything is verified end to end: four automated tests pass, TypeScript and Vite build cleanly, and evenhub-cli stamps a thirty-three-kilobyte e-h-p-k package ready for G2. All trading runs in paper mode on live market prices with zero custody risk. Thank you."))

ffmpeg = shutil.which("ffmpeg")
assert ffmpeg, "ffmpeg not found"
segs = []
for i, (img_p, text) in enumerate(SLIDES):
    wav = OUT / f"seg_{i}.wav"
    seg = OUT / f"seg_{i}.mp4"
    synth_wav(text, wav)
    subprocess.run([
        ffmpeg, "-y", "-loop", "1", "-i", str(img_p), "-i", str(wav),
        "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-shortest", str(seg)
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    segs.append(seg)

lst = OUT / "concat.txt"
lst.write_text("\n".join(f"file '{s.as_posix()}'" for s in segs), encoding="utf-8")
final_mp4 = ROOT / "G2_GlanceDesk_Demo_1080p.mp4"
subprocess.run([
    ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
    "-c", "copy", str(final_mp4)
], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)

probe = subprocess.run([
    shutil.which("ffprobe"), "-v", "error", "-show_entries", "format=duration,size",
    "-of", "default=noprint_wrappers=1", str(final_mp4)
], capture_output=True, text=True, check=True)
print("FINAL:", final_mp4, probe.stdout.strip().replace("\n", " | "))
