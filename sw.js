/* 내 레이팅 - 오프라인용 서비스 워커
   앱 파일을 폰에 저장해 두었다가, 인터넷이 없으면 저장해 둔 파일로 앱을 열어요.
   앱 파일을 고쳐 올릴 때 이 파일은 그대로 두면 돼요. (index.html은 항상 최신 것을 먼저 받아와요) */

var CACHE = 'myrating-v1';

// 처음 설치할 때 미리 저장해 두는 앱 파일
var APP_FILES = [
  './',
  'index.html',
  'firebase-config.js',
  'manifest.webmanifest',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 파일 하나가 없어도 나머지는 저장되도록 하나씩 저장해요
      return Promise.all(APP_FILES.map(function (f) {
        return fetch(f, { cache: 'no-cache' }).then(function (r) {
          if (r.ok) return c.put(f, r);
        }).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('myrating-') === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// 인터넷 먼저, 안 되면(또는 4초 넘게 걸리면) 저장해 둔 것
function networkFirst(req, fallbackKeys) {
  return caches.open(CACHE).then(function (c) {
    var net = fetch(req, { cache: 'no-cache' }).then(function (r) {
      if (r && r.ok) {
        var copy = r.clone();
        c.put(req, copy.clone());
        (fallbackKeys || []).forEach(function (k) { c.put(k, copy.clone()); });
      }
      return r;
    });
    var fromCache = function () {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        var keys = (fallbackKeys || []).slice();
        var next = function () {
          if (!keys.length) return undefined;
          return c.match(keys.shift()).then(function (h) { return h || next(); });
        };
        return next();
      });
    };
    var timeout = new Promise(function (res) { setTimeout(res, 4000); }).then(fromCache);
    return Promise.race([
      net.catch(function () { return fromCache(); }),
      timeout.then(function (hit) { return hit || net; })
    ]).then(function (r) { return r || net; }).catch(function () {
      return fromCache().then(function (hit) {
        return hit || new Response('오프라인이에요. 인터넷에 한 번 연결한 뒤 다시 열어 주세요.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    });
  });
}

// 저장해 둔 것 먼저 보여주고, 뒤에서 새 버전으로 바꿔 두기 (글꼴, Firebase 코드)
function cacheFirst(req) {
  return caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (hit) {
      var net = fetch(req).then(function (r) {
        if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone());
        return r;
      });
      if (hit) { net.catch(function () {}); return hit; }
      return net;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // 앱 화면(페이지 열기)
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    e.respondWith(networkFirst(req, ['./', 'index.html']));
    return;
  }

  // 같은 사이트의 앱 파일 (설정 파일, 아이콘 등)
  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
    return;
  }

  // 글꼴과 Firebase 코드
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' ||
      (url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0)) {
    e.respondWith(cacheFirst(req));
    return;
  }

  // 그 밖의 것(검색, 데이터베이스, AI, 음악 플레이어)은 저장하지 않고 그대로 인터넷으로 보내요
});
