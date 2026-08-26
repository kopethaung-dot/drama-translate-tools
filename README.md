# Subtitle Studio — Setup Guide

## ဖိုင်တွေ ဘယ်လိုစီစဉ်ထားလဲ
```
subtitle-tool/
  functions/        ← Firebase Cloud Functions (backend)
    index.js
    gemini.js        (Gemini API transcribe+translate)
    srt.js           (SRT format generator)
    download.js      (TikTok/RedNote link downloader)
    r2.js            (Cloudflare R2 upload helper)
    fonts/           ← ဒီထဲမှာ Padauk-Regular.ttf ထည့်ရမည် (မြန်မာစာ burn-in အတွက် မဖြစ်မနေလိုအပ်)
    package.json
  public/
    index.html       ← frontend (GitHub Pages မှာ host လုပ်ရန်)
  worker/
    worker.js        ← Cloudflare Worker (R2 upload proxy)
  firestore.rules
  storage.rules
```

## 1) Firebase Project Setup
1. Firebase Console မှာ project အသစ် (သို့) ရှိပြီးသား project သုံးပါ။
2. **Blaze (pay-as-you-go) plan** လိုအပ်ပါတယ် — Cloud Functions 2nd gen + video processing (ffmpeg) အတွက် Spark plan (free) နဲ့ မရပါ (Maxflix မှာလည်း ဒီအချက် ကြုံခဲ့တာ ပါ)
3. Firestore + Storage ကို enable လုပ်ပါ
4. `firestore.rules` နဲ့ `storage.rules` ကို deploy လုပ်ပါ:
   ```
   firebase deploy --only firestore:rules,storage:rules
   ```
5. `public/index.html` ထဲက `firebaseConfig` ကို project ရဲ့ config နဲ့ အစားထိုးပါ

## 2) Gemini API Key — **တစ်ခါထည့်ရင် ပြီးပါပြီ**
- https://aistudio.google.com/apikey ကနေ API key ယူပါ
- ဒီ command ကို **တစ်ကြိမ်တည်း** run ပါ:
  ```
  firebase functions:secrets:set GEMINI_API_KEY
  ```
  (key ကို paste လုပ်ခိုင်းပါလိမ့်မယ်)
- ဒါဆို Google Secret Manager ထဲ အမြဲသိမ်းထားပြီး၊ နောက်ပိုင်း `firebase deploy` လုပ်တိုင်း ထပ်ထည့်စရာ **မလိုပါဘူး**။ Key ကို ပြောင်းချင်မှ (rotate) ထပ်တစ်ခေါက် run ပေးရပါမယ်။

## 3) Cloudflare R2 + Worker — ဒီ project အတွက် **သီးသန့်** (တခြားဘယ် project ကိုမှ မမျှဝေပါ)
1. Cloudflare Dashboard → R2 → ဒီ project အတွက်ပဲ သုံးမယ့် bucket အသစ် ဖန်တီးပါ (ဥပမာ `drama-translate-videos` — Maxflix ရဲ့ bucket နဲ့ လုံးဝမတူအောင် နာမည်ခွဲပါ)
2. Bucket ကို public access ဖွင့်ပါ (သို့) custom domain ချိတ်ပါ
3. `worker/worker.js` ကို Cloudflare Workers အနေနဲ့ **project အသစ်တစ်ခုအနေနဲ့** deploy လုပ်ပါ (ဥပမာ Worker နာမည် `drama-translate-upload`)
4. Worker settings မှာ:
   - R2 bucket binding: `SUBTITLE_BUCKET` ← အထက်က ဖန်တီးထားတဲ့ ဒီ project ပိုင် bucket ကိုပဲ ချိတ်ပါ
   - Environment variable `UPLOAD_SECRET` ← ဒီ project အတွက်ပဲ သုံးမယ့် password string အသစ် တစ်ခု (Maxflix ရဲ့ secret နဲ့ မတူပါစေနဲ့)
   - Environment variable `PUBLIC_BASE_URL` ← ဒီ bucket ရဲ့ public URL
5. Cloud Functions secrets ထဲမှာ (ဒါလည်း **တစ်ခါတည်း** set လုပ်ရုံပါပဲ, deploy တိုင်း ထပ်ထည့်စရာမလို):
   ```
   firebase functions:secrets:set R2_WORKER_UPLOAD_URL
   firebase functions:secrets:set R2_WORKER_SECRET
   ```
   (ပထမ command အတွက် သင့် Worker ရဲ့ URL ကို paste ပါ၊ ဒုတိယ command အတွက် အထက်က `UPLOAD_SECRET` တန်ဖိုးအတူတူကို paste ပါ)

## 4) မြန်မာစာ Burn-in Font (အရေးကြီးဆုံးအချက်)
ffmpeg ရဲ့ default font တွေက မြန်မာစာကို မပြသနိုင်ပါ (box ချောင်းလေးတွေချည်း ပေါ်လိမ့်မယ်)။
- Padauk font ကို ဒီကနေ download လုပ်ပါ: https://fonts.google.com/specimen/Padauk
- `Padauk-Regular.ttf` ကို `functions/fonts/` folder ထဲ ထည့်ပါ
- ဒါဆို burn-in video ပေါ်က မြန်မာစာတန်းက ပီပီပြင်ပြင် ပေါ်ပါလိမ့်မယ်

## 5) Deploy
Secrets တွေ တစ်ခါ set ပြီးသွားရင် ဒါကိုပဲ run ရမှာ (နောက်ထပ် deploy တိုင်းလည်း ဒါကိုပဲ run ရုံပါပဲ, secrets ထပ်ထည့်စရာမလို):
```
cd functions
npm install
cd ..
firebase deploy --only functions
```
Worker ကိုတော့ Cloudflare Dashboard (သို့) `wrangler deploy` နဲ့ သီးသန့် deploy လုပ်ရပါမယ်။
Frontend (`public/index.html`) ကို ရှိပြီးသား GitHub Pages repo ထဲ ထည့်ပြီး push လုပ်ရုံပါပဲ။

## System ဘယ်လိုအလုပ်လုပ်လဲ
1. User က video file တင် (သို့) TikTok/RedNote link ကူးထည့် → target language တွေ ရွေး
2. **File upload:** frontend က `createUploadJob` ခေါ်ပြီး Storage ကို တိုက်ရိုက် upload တင်မယ် → Storage trigger (`onVideoUploaded`) က အလိုအလျောက် စလုပ်မယ်
   **Link:** `submitLink` က video ကို yt-dlp နဲ့ ဆွဲပြီး တစ်ကြိမ်တည်းနဲ့ pipeline စလုပ်မယ်
3. Gemini API က video ကို နားထောင်ပြီး original speech ကို timestamp တွေနဲ့ transcribe လုပ်ပြီး၊ ရွေးထားတဲ့ ဘာသာစကားတွေအားလုံးကို (context ကိုနားလည်ပြီး) natural translation လုပ်ပေးမယ်
4. ဘာသာစကား တစ်ခုချင်းစီအတွက် SRT text ကို Firestore မှာ သိမ်းမယ် (frontend က realtime listen လုပ်နေမယ်)
5. Status "Ready" ရောက်ရင် — user က burn-in language ရွေးပြီး **Render Preview** နှိပ်ရင် `renderBurnedVideo` က ffmpeg နဲ့ subtitle ကို video ပေါ် ထိုးပြီး Cloudflare R2 ကို upload တင်မယ် → preview player ပေါ်ပြမယ်
6. Video download button (subtitle ထိုးပြီးသား) နဲ့ SRT download (filename edit လုပ်လို့ရ, language အလိုက်) နှစ်ခုလုံး ရနိုင်ပါပြီ

## မှတ်ချက်
- Video length ၅ မိနစ်အောက်အတွက် config လုပ်ထားတာဖြစ်လို့ (memory 2GiB, timeout 540s) ပိုရှည်ရင် config တိုးဖို့လိုပါမယ်
- `jobs` collection ကို auth မထားဘဲ jobId ကိုသိရင် read လို့ရအောင် ရိုးရှင်းအောင် ဖွဲ့ထားပါတယ် (တခြား tool တွေအတိုင်း) — အများသုံးဖို့ဆိုရင် auth ထည့်ဖို့ စဉ်းစားသင့်ပါတယ်
