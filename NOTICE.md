# Notices

## Third-party attribution

The WhatsApp Web CSS selector lists in `css/` are derived from
**Privacy Extension For WhatsApp™ Web**, which is distributed under the MIT
License. The selectors are functional facts about WhatsApp Web's DOM, but the
compilation of them originates there, so the original notice is retained below.

- Original: Copyright (c) 2024 Lukas Lenhardt — https://github.com/LukasLen/Privacy-Extension-For-WhatsApp-Web
- Maintained fork used as the reference for current selectors: Copyright (c) 2026 M Aryo Muzakki — https://github.com/aryomuzakki/privacy-whatsapp-web-auto-blur

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The popup UI, the settings schema, the injection engine, the icon generator and
the test harness in this repository are original work.

## Trademark disclaimer

WhatsApp is a trademark of WhatsApp LLC, a Meta company. This extension is an
independent project. It is not affiliated with, endorsed by, or connected to
WhatsApp LLC or Meta in any way.

## Data handling

This extension makes no network requests. It does not read, store, or transmit
message content. The only data it persists is the user's own toggle preferences,
held in `chrome.storage.sync`, and it only runs on `https://web.whatsapp.com/*`.
