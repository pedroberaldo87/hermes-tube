// node_modules/preact/dist/preact.module.js
var n;
var l$1;
var u$2;
var i$2;
var r$1;
var o$1;
var e$1;
var f$2;
var c$1;
var a$1;
var s$1;
var h$1;
var p$2;
var v$1;
var d$1 = {};
var w$1 = [];
var _ = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
var g = Array.isArray;
function m$1(n, l) {
	for (var u in l) n[u] = l[u];
	return n;
}
function b(n) {
	n && n.parentNode && n.parentNode.removeChild(n);
}
function k$1(l, u, t) {
	var i, r, o, e = {};
	for (o in u) "key" == o ? i = u[o] : "ref" == o ? r = u[o] : e[o] = u[o];
	if (arguments.length > 2 && (e.children = arguments.length > 3 ? n.call(arguments, 2) : t), "function" == typeof l && null != l.defaultProps) for (o in l.defaultProps) void 0 === e[o] && (e[o] = l.defaultProps[o]);
	return x(l, e, i, r, null);
}
function x(n, t, i, r, o) {
	var e = {
		type: n,
		props: t,
		key: i,
		ref: r,
		__k: null,
		__: null,
		__b: 0,
		__e: null,
		__c: null,
		constructor: void 0,
		__v: null == o ? ++u$2 : o,
		__i: -1,
		__u: 0
	};
	return null == o && null != l$1.vnode && l$1.vnode(e), e;
}
function S(n) {
	return n.children;
}
function C$1(n, l) {
	this.props = n, this.context = l;
}
function $(n, l) {
	if (null == l) return n.__ ? $(n.__, n.__i + 1) : null;
	for (var u; l < n.__k.length; l++) if (null != (u = n.__k[l]) && null != u.__e) return u.__e;
	return "function" == typeof n.type ? $(n) : null;
}
function I(n) {
	if (n.__P && n.__d) {
		var u = n.__v, t = u.__e, i = [], r = [], o = m$1({}, u);
		o.__v = u.__v + 1, l$1.vnode && l$1.vnode(o), q$1(n.__P, o, u, n.__n, n.__P.namespaceURI, 32 & u.__u ? [t] : null, i, null == t ? $(u) : t, !!(32 & u.__u), r), o.__v = u.__v, o.__.__k[o.__i] = o, D$1(i, o, r), u.__e = u.__ = null, o.__e != t && P$1(o);
	}
}
function P$1(n) {
	if (null != (n = n.__) && null != n.__c) return n.__e = n.__c.base = null, n.__k.some(function(l) {
		if (null != l && null != l.__e) return n.__e = n.__c.base = l.__e;
	}), P$1(n);
}
function A$1(n) {
	(!n.__d && (n.__d = !0) && i$2.push(n) && !H.__r++ || r$1 != l$1.debounceRendering) && ((r$1 = l$1.debounceRendering) || o$1)(H);
}
function H() {
	try {
		for (var n, l = 1; i$2.length;) i$2.length > l && i$2.sort(e$1), n = i$2.shift(), l = i$2.length, I(n);
	} finally {
		i$2.length = H.__r = 0;
	}
}
function L(n, l, u, t, i, r, o, e, f, c, a) {
	var s, h, p, v, y, _, g = t && t.__k || w$1, m = l.length;
	for (f = T$1(u, l, g, f, m), s = 0; s < m; s++) null != (p = u.__k[s]) && (h = -1 != p.__i && g[p.__i] || d$1, p.__i = s, _ = q$1(n, p, h, i, r, o, e, f, c, a), v = p.__e, p.ref && h.ref != p.ref && (h.ref && J(h.ref, null, p), a.push(p.ref, p.__c || v, p)), null == y && null != v && (y = v), 4 & p.__u ? (f = j$1(p, f, n), h.__e && (h.__e = null)) : "function" == typeof p.type && void 0 !== _ ? f = _ : v && (f = v.nextSibling), p.__u &= -7);
	return u.__e = y, f;
}
function T$1(n, l, u, t, i) {
	var r, o, e, f, c, a = u.length, s = a, h = 0;
	for (n.__k = new Array(i), r = 0; r < i; r++) null != (o = l[r]) && "boolean" != typeof o && "function" != typeof o ? ("string" == typeof o || "number" == typeof o || "bigint" == typeof o || o.constructor == String ? o = n.__k[r] = x(null, o, null, null, null) : g(o) ? o = n.__k[r] = x(S, { children: o }, null, null, null) : void 0 === o.constructor && o.__b > 0 ? o = n.__k[r] = x(o.type, o.props, o.key, o.ref ? o.ref : null, o.__v) : n.__k[r] = o, f = r + h, o.__ = n, o.__b = n.__b + 1, e = null, -1 != (c = o.__i = O(o, u, f, s)) && (s--, (e = u[c]) && (e.__u |= 2)), null == e || null == e.__v ? (-1 == c && (i > a ? h-- : i < a && h++), "function" != typeof o.type && (o.__u |= 4)) : c != f && (c == f - 1 ? h-- : c == f + 1 ? h++ : (c > f ? h-- : h++, o.__u |= 4))) : n.__k[r] = null;
	if (s) for (r = 0; r < a; r++) null != (e = u[r]) && 0 == (2 & e.__u) && (e.__e == t && (t = $(e)), K(e, e));
	return t;
}
function j$1(n, l, u) {
	var t, i;
	if ("function" == typeof n.type) {
		for (t = n.__k, i = 0; t && i < t.length; i++) t[i] && (t[i].__ = n, l = j$1(t[i], l, u));
		return l;
	}
	n.__e != l && (l && n.type && !l.parentNode && (l = $(n)), l = u.insertBefore(n.__e, l || null));
	do
		l = l && l.nextSibling;
	while (null != l && 8 == l.nodeType);
	return l;
}
function O(n, l, u, t) {
	var i, r, o, e = n.key, f = n.type, c = l[u], a = null != c && 0 == (2 & c.__u);
	if (null === c && null == e || a && e == c.key && f == c.type) return u;
	if (t > (a ? 1 : 0)) {
		for (i = u - 1, r = u + 1; i >= 0 || r < l.length;) if (null != (c = l[o = i >= 0 ? i-- : r++]) && 0 == (2 & c.__u) && e == c.key && f == c.type) return o;
	}
	return -1;
}
function z$1(n, l, u) {
	"-" == l[0] ? n.setProperty(l, null == u ? "" : u) : n[l] = null == u ? "" : "number" != typeof u || _.test(l) ? u : u + "px";
}
function N(n, l, u, t, i) {
	var r, o;
	n: if ("style" == l) if ("string" == typeof u) n.style.cssText = u;
	else {
		if ("string" == typeof t && (n.style.cssText = t = ""), t) for (l in t) u && l in u || z$1(n.style, l, "");
		if (u) for (l in u) t && u[l] == t[l] || z$1(n.style, l, u[l]);
	}
	else if ("o" == l[0] && "n" == l[1]) r = l != (l = l.replace(s$1, "$1")), o = l.toLowerCase(), l = o in n || "onFocusOut" == l || "onFocusIn" == l ? o.slice(2) : l.slice(2), n.l || (n.l = {}), n.l[l + r] = u, u ? t ? u[a$1] = t[a$1] : (u[a$1] = h$1, n.addEventListener(l, r ? v$1 : p$2, r)) : n.removeEventListener(l, r ? v$1 : p$2, r);
	else {
		if ("http://www.w3.org/2000/svg" == i) l = l.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
		else if ("width" != l && "height" != l && "href" != l && "list" != l && "form" != l && "tabIndex" != l && "download" != l && "rowSpan" != l && "colSpan" != l && "role" != l && "popover" != l && l in n) try {
			n[l] = null == u ? "" : u;
			break n;
		} catch (n) {}
		"function" == typeof u || (null == u || !1 === u && "-" != l[4] ? n.removeAttribute(l) : n.setAttribute(l, "popover" == l && 1 == u ? "" : u));
	}
}
function V(n) {
	return function(u) {
		if (this.l) {
			var t = this.l[u.type + n];
			if (null == u[c$1]) u[c$1] = h$1++;
			else if (u[c$1] < t[a$1]) return;
			return t(l$1.event ? l$1.event(u) : u);
		}
	};
}
function q$1(n, u, t, i, r, o, e, f, c, a) {
	var s, h, p, v, y, d, _, k, x, M, I, P, A, H, T, j, F = u.type;
	if (void 0 !== u.constructor) return null;
	128 & t.__u && (c = !!(32 & t.__u), o = [f = u.__e = t.__e]), (s = l$1.__b) && s(u);
	n: if ("function" == typeof F) {
		h = e.length;
		try {
			if (x = u.props, M = F.prototype && F.prototype.render, I = (s = F.contextType) && i[s.__c], P = s ? I ? I.props.value : s.__ : i, t.__c ? k = (p = u.__c = t.__c).__ = p.__E : (M ? u.__c = p = new F(x, P) : (u.__c = p = new C$1(x, P), p.constructor = F, p.render = Q$1), I && I.sub(p), p.state || (p.state = {}), p.__n = i, v = p.__d = !0, p.__h = [], p._sb = []), M && null == p.__s && (p.__s = p.state), M && null != F.getDerivedStateFromProps && (p.__s == p.state && (p.__s = m$1({}, p.__s)), m$1(p.__s, F.getDerivedStateFromProps(x, p.__s))), y = p.props, d = p.state, p.__v = u, v) M && null == F.getDerivedStateFromProps && null != p.componentWillMount && p.componentWillMount(), M && null != p.componentDidMount && p.__h.push(p.componentDidMount);
			else {
				if (M && null == F.getDerivedStateFromProps && x !== y && null != p.componentWillReceiveProps && p.componentWillReceiveProps(x, P), u.__v == t.__v || !p.__e && null != p.shouldComponentUpdate && !1 === p.shouldComponentUpdate(x, p.__s, P)) {
					u.__v != t.__v && (p.props = x, p.state = p.__s, p.__d = !1), u.__e = t.__e, u.__k = t.__k, u.__k.some(function(n) {
						n && (n.__ = u);
					}), w$1.push.apply(p.__h, p._sb), p._sb = [], p.__h.length && e.push(p), f = $(t);
					break n;
				}
				null != p.componentWillUpdate && p.componentWillUpdate(x, p.__s, P), M && null != p.componentDidUpdate && p.__h.push(function() {
					p.componentDidUpdate(y, d, _);
				});
			}
			if (p.context = P, p.props = x, p.__P = n, p.__e = !1, A = l$1.__r, H = 0, M) p.state = p.__s, p.__d = !1, A && A(u), s = p.render(p.props, p.state, p.context), w$1.push.apply(p.__h, p._sb), p._sb = [];
			else do
				p.__d = !1, A && A(u), s = p.render(p.props, p.state, p.context), p.state = p.__s;
			while (p.__d && ++H < 25);
			p.state = p.__s, null != p.getChildContext && (i = m$1(m$1({}, i), p.getChildContext())), M && !v && null != p.getSnapshotBeforeUpdate && (_ = p.getSnapshotBeforeUpdate(y, d)), T = null != s && s.type === S && null == s.key ? E(s.props.children) : s, f = L(n, g(T) ? T : [T], u, t, i, r, o, e, f, c, a), p.base = u.__e, u.__u &= -161, p.__h.length && e.push(p), k && (p.__E = p.__ = null);
		} catch (n) {
			if (e.length = h, u.__v = null, c || null != o) {
				if (n.then) {
					for (u.__u |= c ? 160 : 128; f && 8 == f.nodeType && f.nextSibling;) f = f.nextSibling;
					null != o && (o[o.indexOf(f)] = null), u.__e = f;
				} else if (null != o) for (j = o.length; j--;) b(o[j]);
			} else u.__e = t.__e;
			u.__k ??= t.__k || [], n.then || B$1(u), l$1.__e(n, u, t);
		}
	} else null == o && u.__v == t.__v ? (u.__k = t.__k, u.__e = t.__e) : f = u.__e = G(t.__e, u, t, i, r, o, e, c, a);
	return (s = l$1.diffed) && s(u), 128 & u.__u ? void 0 : f;
}
function B$1(n) {
	n && (n.__c && (n.__c.__e = !0), n.__k && n.__k.some(B$1));
}
function D$1(n, u, t) {
	for (var i = 0; i < t.length; i++) J(t[i], t[++i], t[++i]);
	l$1.__c && l$1.__c(u, n), n.some(function(u) {
		try {
			n = u.__h, u.__h = [], n.some(function(n) {
				n.call(u);
			});
		} catch (n) {
			l$1.__e(n, u.__v);
		}
	});
}
function E(n) {
	return "object" != typeof n || null == n || n.__b > 0 ? n : g(n) ? n.map(E) : void 0 !== n.constructor ? null : m$1({}, n);
}
function G(u, t, i, r, o, e, f, c, a) {
	var s, h, p, v, y, w, _, m = i.props || d$1, k = t.props, x = t.type;
	if ("svg" == x ? o = "http://www.w3.org/2000/svg" : "math" == x ? o = "http://www.w3.org/1998/Math/MathML" : o || (o = "http://www.w3.org/1999/xhtml"), null != e) {
		for (s = 0; s < e.length; s++) if ((y = e[s]) && "setAttribute" in y == !!x && (x ? y.localName == x : 3 == y.nodeType)) {
			u = y, e[s] = null;
			break;
		}
	}
	if (null == u) {
		if (null == x) return document.createTextNode(k);
		u = document.createElementNS(o, x, k.is && k), c && (l$1.__m && l$1.__m(t, e), c = !1), e = null;
	}
	if (null == x) m === k || c && u.data == k || (u.data = k);
	else {
		if (e = "textarea" == x && null != k.defaultValue ? null : e && n.call(u.childNodes), !c && null != e) for (m = {}, s = 0; s < u.attributes.length; s++) m[(y = u.attributes[s]).name] = y.value;
		for (s in m) y = m[s], "dangerouslySetInnerHTML" == s ? p = y : "children" == s || s in k || "value" == s && "defaultValue" in k || "checked" == s && "defaultChecked" in k || N(u, s, null, y, o);
		for (s in k) y = k[s], "children" == s ? v = y : "dangerouslySetInnerHTML" == s ? h = y : "value" == s ? w = y : "checked" == s ? _ = y : c && "function" != typeof y || m[s] === y || N(u, s, y, m[s], o);
		if (h) c || p && (h.__html == p.__html || h.__html == u.innerHTML) || (u.innerHTML = h.__html), t.__k = [];
		else if (p && (u.innerHTML = ""), L("template" == t.type ? u.content : u, g(v) ? v : [v], t, i, r, "foreignObject" == x ? "http://www.w3.org/1999/xhtml" : o, e, f, e ? e[0] : i.__k && $(i, 0), c, a), null != e) for (s = e.length; s--;) b(e[s]);
		c && "textarea" != x || (s = "value", "progress" == x && null == w ? u.removeAttribute("value") : null != w && (w !== u[s] || "progress" == x && !w || "option" == x && w != m[s]) && N(u, s, w, m[s], o), s = "checked", null != _ && _ != u[s] && N(u, s, _, m[s], o));
	}
	return u;
}
function J(n, u, t) {
	try {
		if ("function" == typeof n) {
			var i = "function" == typeof n.__u;
			i && n.__u(), i && null == u || (n.__u = n(u));
		} else n.current = u;
	} catch (n) {
		l$1.__e(n, t);
	}
}
function K(n, u, t) {
	var i, r;
	if (l$1.unmount && l$1.unmount(n), (i = n.ref) && (i.current && i.current != n.__e || J(i, null, u)), null != (i = n.__c)) {
		if (i.componentWillUnmount) try {
			i.componentWillUnmount();
		} catch (n) {
			l$1.__e(n, u);
		}
		i.base = i.__P = i.__n = null;
	}
	if (i = n.__k) for (r = 0; r < i.length; r++) i[r] && K(i[r], u, t || "function" != typeof n.type);
	t || b(n.__e), n.__c = n.__ = n.__e = void 0;
}
function Q$1(n, l, u) {
	return this.constructor(n, u);
}
function R(u, t, i) {
	var r, o, e, f;
	t == document && (t = document.documentElement), l$1.__ && l$1.__(u, t), o = (r = "function" == typeof i) ? null : i && i.__k || t.__k, e = [], f = [], q$1(t, u = (!r && i || t).__k = k$1(S, null, [u]), o || d$1, d$1, t.namespaceURI, !r && i ? [i] : o ? null : t.firstChild ? n.call(t.childNodes) : null, e, !r && i ? i : o ? o.__e : t.firstChild, r, f), D$1(e, u, f), u.props.children = null;
}
n = w$1.slice, l$1 = { __e: function(n, l, u, t) {
	for (var i, r, o; l = l.__;) if ((i = l.__c) && !i.__) try {
		if ((r = i.constructor) && null != r.getDerivedStateFromError && (i.setState(r.getDerivedStateFromError(n)), o = i.__d), null != i.componentDidCatch && (i.componentDidCatch(n, t || {}), o = i.__d), o) return i.__E = i;
	} catch (l) {
		n = l;
	}
	throw n;
} }, u$2 = 0, C$1.prototype.setState = function(n, l) {
	var u = null != this.__s && this.__s != this.state ? this.__s : this.__s = m$1({}, this.state);
	"function" == typeof n && (n = n(m$1({}, u), this.props)), n && m$1(u, n), null != n && this.__v && (l && this._sb.push(l), A$1(this));
}, C$1.prototype.forceUpdate = function(n) {
	this.__v && (this.__e = !0, n && this.__h.push(n), A$1(this));
}, C$1.prototype.render = S, i$2 = [], o$1 = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e$1 = function(n, l) {
	return n.__v.__b - l.__v.__b;
}, H.__r = 0, f$2 = Math.random().toString(8), c$1 = "__d" + f$2, a$1 = "__a" + f$2, s$1 = /(PointerCapture)$|Capture$/i, h$1 = 0, p$2 = V(!1), v$1 = V(!0);
// shared/ext-messages.ts
/** Keys in chrome.storage.local (Hermes is the source of truth; here only cache and credential). */
var STORAGE_KEYS = {
	/** `{ port, token, device_id, paired_at }` — never log the token. */
	connection: "conn",
	/** last `ExtState` + `fetched_at` (ms). */
	stateCache: "state_cache",
	/** local queue of `WatchEvent`s not sent yet. */
	watchOutbox: "watch_outbox",
	/** `SyncStatus` of the last subscriptions sync (the popup reads it; the service worker dies). */
	syncStatus: "sync_status",
	/** scraped batch not sent yet (resend; after 15 min it goes as `partial`). */
	syncPending: "sync_pending",
	/** sync in progress (tab, start) — to close an orphan tab when the service worker restarts. */
	syncRun: "sync_run",
	/** history events refused by the server (`invalid`): diagnostics, never resent. */
	watchRejected: "watch_rejected",
	/** `{ device_name, paired_at }` of the current pairing (pairing writes it, the popup shows it). */
	pairInfo: "pair_info",
	/** port chosen in the popup's "advanced" (absent = automatic discovery). */
	pairPort: "pair_port",
	/** `QueueProgress` of the unsubscribe queue (the executor writes it, the popup shows it) + item in progress. */
	queueRun: "queue_run",
	/** `{ stopped, by, at }` — "Stop" (popup/notice on the page). It only stops; never tells anything to run. */
	queueCtl: "queue_ctl",
	/** items already started: never run again. */
	queueLedger: "queue_ledger",
	/** folders open in the youtube.com sidebar (`{expanded: string[]}`). */
	sidebarTree: "sidebar_tree"
};
// extension/src/background/welcome.ts
/** `true` when the popup page was opened as the first-load tab (by its query string). */
function isWelcomeSurface(search) {
	return new URLSearchParams(search).get("welcome") === "1";
}
// node_modules/preact/hooks/dist/hooks.module.js
var t$1;
var r;
var u$1;
var i$1;
var o = 0;
var f$1 = [];
var c = l$1;
var e = c.__b;
var a = c.__r;
var v = c.diffed;
var l = c.__c;
var m = c.unmount;
var p$1 = c.__;
function s(n, t) {
	c.__h && c.__h(r, n, o || t), o = 0;
	var u = r.__H || (r.__H = {
		__: [],
		__h: []
	});
	return n >= u.__.length && u.__.push({}), u.__[n];
}
function d(n) {
	return o = 1, y(D, n);
}
function y(n, u, i) {
	var o = s(t$1++, 2);
	if (o.t = n, !o.__c && (o.__ = [i ? i(u) : D(void 0, u), function(n) {
		var t = o.__N ? o.__N[0] : o.__[0], r = o.t(t, n);
		t !== r && (o.__N = [r, o.__[1]], o.__c.setState({}));
	}], o.__c = r, !r.__f)) {
		var f = function(n, t, r) {
			if (!o.__c.__H) return !0;
			var u = !1, i = o.__c.props !== n;
			if (o.__c.__H.__.some(function(n) {
				if (n.__N) {
					u = !0;
					var t = n.__[0];
					n.__ = n.__N, n.__N = void 0, t !== n.__[0] && (i = !0);
				}
			}), c) {
				var f = c.call(this, n, t, r);
				return u ? f || i : f;
			}
			return !u || i;
		};
		r.__f = !0;
		var c = r.shouldComponentUpdate, e = r.componentWillUpdate;
		r.componentWillUpdate = function(n, t, r) {
			if (this.__e) {
				var u = c;
				c = void 0, f(n, t, r), c = u;
			}
			e && e.call(this, n, t, r);
		}, r.shouldComponentUpdate = f;
	}
	return o.__N || o.__;
}
function h(n, u) {
	var i = s(t$1++, 3);
	!c.__s && C(i.__H, u) && (i.__ = n, i.u = u, r.__H.__h.push(i));
}
function A(n) {
	return o = 5, T(function() {
		return { current: n };
	}, []);
}
function T(n, r) {
	var u = s(t$1++, 7);
	return C(u.__H, r) && (u.__ = n(), u.__H = r, u.__h = n), u.__;
}
function q(n, t) {
	return o = 8, T(function() {
		return n;
	}, t);
}
function j() {
	for (var n; n = f$1.shift();) {
		var t = n.__H;
		if (n.__P && t) try {
			t.__h.some(z), t.__h.some(B), t.__h = [];
		} catch (r) {
			t.__h = [], c.__e(r, n.__v);
		}
	}
}
c.__b = function(n) {
	r = null, e && e(n);
}, c.__ = function(n, t) {
	n && t.__k && t.__k.__m && (n.__m = t.__k.__m), p$1 && p$1(n, t);
}, c.__r = function(n) {
	a && a(n), t$1 = 0;
	var i = (r = n.__c).__H;
	i && (u$1 === r ? (i.__h = [], r.__h = [], i.__.some(function(n) {
		n.__N && (n.__ = n.__N), n.u = n.__N = void 0;
	})) : (i.__h.some(z), i.__h.some(B), i.__h = [], t$1 = 0)), u$1 = r;
}, c.diffed = function(n) {
	v && v(n);
	var t = n.__c;
	t && t.__H && (t.__H.__h.length && (1 !== f$1.push(t) && i$1 === c.requestAnimationFrame || ((i$1 = c.requestAnimationFrame) || w)(j)), t.__H.__.some(function(n) {
		n.u && (n.__H = n.u, n.u = void 0);
	})), u$1 = r = null;
}, c.__c = function(n, t) {
	t.some(function(n) {
		try {
			n.__h.some(z), n.__h = n.__h.filter(function(n) {
				return !n.__ || B(n);
			});
		} catch (r) {
			t.some(function(n) {
				n.__h && (n.__h = []);
			}), t = [], c.__e(r, n.__v);
		}
	}), l && l(n, t);
}, c.unmount = function(n) {
	m && m(n);
	var t, r = n.__c;
	r && r.__H && (r.__H.__.some(function(n) {
		try {
			z(n);
		} catch (n) {
			t = n;
		}
	}), r.__H = void 0, t && c.__e(t, r.__v));
};
var k = "function" == typeof requestAnimationFrame;
function w(n) {
	var t, r = function() {
		clearTimeout(u), k && cancelAnimationFrame(t), setTimeout(n);
	}, u = setTimeout(r, 35);
	k && (t = requestAnimationFrame(r));
}
function z(n) {
	var t = r, u = n.__c;
	"function" == typeof u && (n.__c = void 0, u()), r = t;
}
function B(n) {
	var t = r;
	n.__c = n.__(), r = t;
}
function C(n, t) {
	return !n || n.length !== t.length || t.some(function(t, r) {
		return t !== n[r];
	});
}
function D(n, t) {
	return "function" == typeof t ? t(n) : t;
}
// shared/ids.ts
var PLUGIN_ID = "hermes-tube";
/** Owner of each page in contract/owners.yaml (desktop_routes). */
var DESKTOP_ROUTES = {
	home: `/${PLUGIN_ID}`,
	manage: `/${PLUGIN_ID}/manage`,
	cleanup: `/${PLUGIN_ID}/cleanup`,
	extras: `/${PLUGIN_ID}/extras`
};
var EXT_PORT_BASE = 47615;
Array.from({ length: 10 }, (_, i) => EXT_PORT_BASE + i);
// shared/api-types.ts
/** Every error code, in x-error-codes order. */
var ERROR_CODES = [
	"not_found",
	"conflict",
	"invalid",
	"unauthorized",
	"undo_refused",
	"approval_refused",
	"timeout",
	"busy",
	"llm_unavailable",
	"llm_invalid",
	"youtube_error",
	"http_error",
	"origin_forbidden",
	"origin_required",
	"origin_mismatch",
	"host_forbidden",
	"plugin_disabled",
	"no_active_code",
	"invalid_code",
	"expired",
	"used",
	"locked",
	"ext_endpoint_down",
	"internal"
];
// extension/src/lib/envelope.ts
function fail(code, message, extra = {}) {
	const error = {
		code,
		message
	};
	if (extra.reason !== void 0) error.reason = extra.reason;
	if (extra.details !== void 0) error.details = extra.details;
	return {
		ok: false,
		error
	};
}
var CODES = new Set(ERROR_CODES);
/** Does the value have the shape of a contract envelope? (decided by the body, not the HTTP status) */
function isEnvelope(v) {
	if (!v || typeof v !== "object") return false;
	const e = v;
	if (e.ok === true) return "data" in e;
	if (e.ok !== false || !e.error || typeof e.error !== "object") return false;
	const err = e.error;
	return typeof err.code === "string" && CODES.has(err.code) && typeof err.message === "string";
}
/** Short message for any exception (no stack). */
function errorMessage(e) {
	if (e instanceof Error) return e.message || e.name;
	return String(e);
}
// extension/src/lib/i18n.ts
var CATALOGS = {
	en: {
		common: {
			reconnect_open_hermes: "Open Hermes to reconnect",
			unpaired: "Not connected to Hermes yet",
			unauthorized: "Hermes did not accept this browser. Pair again.",
			connected: "Connected to Hermes",
			connected_port: "Connected to Hermes (port {port})",
			timeout: "Hermes took too long to answer",
			error: "Something went wrong talking to Hermes",
			invalid_response: "Unexpected answer from Hermes",
			server_unverified: "The program answering on this port could not prove it is your Hermes, so the extension did not send anything. Open Hermes, or pair again.",
			server_outdated: "Hermes needs a newer version of the HermesTube plugin to pair with this extension.",
			code_mismatch: "The code did not match the one Hermes is showing."
		},
		popup: {
			app_name: "Hermes · Subscriptions",
			loading: "Loading…",
			pill_connected: "Connected",
			pill_checking: "Checking…",
			pill_unpaired: "Not connected",
			pill_reconnect_needed: "Hermes closed",
			pill_unauthorized: "Pairing refused",
			pill_error: "Needs attention",
			tagline: "Connect this browser to Hermes to organize your YouTube subscriptions.",
			code_label: "Pairing code",
			code_hint: "6 digits, shown in Hermes. Pasting works.",
			connect: "Connect",
			pairing: "Looking for Hermes…",
			where_code: "Where do I find the code?",
			where_step1: "Open the Hermes desktop app.",
			where_step2: "Go to the plugin page (YouTube subscriptions).",
			where_step3: "Click “Connect extension”. A 6-digit code appears; it is valid for 5 minutes.",
			advanced: "Advanced",
			address_label: "Hermes address",
			address_placeholder: "automatic",
			address_hint: "Leave empty: the extension finds Hermes on this computer by itself.",
			address_invalid: "Use an address on this computer, like http://127.0.0.1:47615",
			err_invalid_code_one: "Wrong code. {count} attempt left.",
			err_invalid_code_other: "Wrong code. {count} attempts left.",
			err_invalid_code: "Wrong code. Check the digits in Hermes.",
			err_expired: "This code has expired (each code lasts 5 minutes). Get a new one in Hermes.",
			err_used: "This code was already used. Get a new one in Hermes.",
			err_locked: "Too many wrong tries, so the code was blocked. Get a new one in Hermes.",
			err_no_active_code: "Hermes is open but has no active code. Click “Connect extension” on the plugin page.",
			err_ext_endpoint_down: "Can't find Hermes on this computer. Open Hermes and the plugin page, then try again.",
			err_invalid: "The code has 6 digits.",
			err_timeout: "Hermes took too long to answer. Try again.",
			err_plugin_disabled: "The plugin is turned off in Hermes. Turn it on and try again.",
			err_refused: "Hermes refused this browser. Get a new code and try again.",
			err_other: "Couldn't connect. Try again.",
			err_server_unverified: "Something on this computer answered instead of Hermes, so the code was not used. Open Hermes Desktop on the pairing screen and try again.",
			err_server_outdated: "Update the HermesTube plugin in Hermes, then pair again.",
			this_browser: "This browser",
			paired_on: "Paired {date}",
			seen: "Hermes answered {when}",
			details: "Details",
			details_address: "Address: {address}",
			details_device: "Device: {id}",
			just_now: "just now",
			last_sync: "Last sync",
			sync_never: "Not synced yet.",
			sync_channels_one: "{count} channel",
			sync_channels_other: "{count} channels",
			sync_complete: "full list",
			sync_partial: "partial",
			sync_partial_note: "Partial list: nothing was marked as unsubscribed.",
			sync_last_ok: "Last successful sync: {when}.",
			sync_never_ok: "No successful sync yet.",
			needs_visible: "Needs a visible sync: in the background, YouTube didn't load the whole list. Click “Sync now”.",
			reason_scroll_stalled: "YouTube stopped loading the list before the end.",
			reason_timeout: "Reading the list took too long.",
			reason_logged_out: "It looks like you're not signed in to YouTube.",
			reason_missing_ids: "Some channels could not be identified and were left out.",
			reason_too_many: "More than 5000 channels: only the first ones were sent.",
			reason_stale: "The list was sent late, so it counts as partial.",
			reason_cancelled: "Reading was cancelled.",
			reason_aborted: "Reading was interrupted.",
			reason_empty: "The subscriptions page was empty.",
			reason_server_partial: "Many channels were missing from the list at once, so Hermes did not mark them as unsubscribed. Nothing changed on YouTube.",
			reason_other: "YouTube's page looked different than expected.",
			sync_err_tab_closed: "The YouTube tab was closed before the end.",
			sync_err_tab_timeout: "YouTube took too long to load your subscriptions.",
			sync_err_scrape_failed: "Couldn't read your subscriptions on YouTube.",
			sync_err_nothing_to_send: "No subscriptions found on the page.",
			sync_err_logged_out: "Sign in to YouTube in this browser to sync.",
			sync_err_ext_endpoint_down: "Hermes was closed; the list goes out when it's back.",
			sync_err_timeout: "Hermes took too long to answer; the list will be sent again.",
			sync_err_invalid: "Hermes rejected the list (extension bug).",
			sync_err_cancelled: "Sync cancelled; nothing was sent.",
			sync_err_unauthorized: "Hermes did not accept this browser.",
			sync_err_not_started: "The sync didn't start. Try again.",
			sync_err_other: "The sync failed.",
			sync_now: "Sync now",
			syncing: "Reading your subscriptions on YouTube…",
			syncing_since: "Started {when}.",
			syncing_note: "A YouTube tab stays open meanwhile. Nothing changes in your account.",
			open_hermes: "Open in Hermes",
			disconnect: "Disconnect",
			disconnect_title: "Disconnect this browser?",
			disconnect_body: "Hermes stops getting your subscriptions from here, and what the extension saved in this browser is erased. Nothing changes on YouTube.",
			cancel: "Cancel",
			disconnect_yes: "Disconnect",
			disconnecting: "Disconnecting…",
			problem_closed_title: "Hermes is closed",
			problem_closed_body: "Open Hermes and the plugin page. The extension reconnects by itself.",
			problem_unauthorized_title: "Hermes no longer recognizes this browser",
			problem_unauthorized_body: "The pairing was removed in Hermes. Pair again with a new code.",
			problem_logged_out_title: "Sign in to YouTube",
			problem_logged_out_body: "To read your subscriptions, sign in to your YouTube account in this browser. Then sync again.",
			problem_error_title: "Something is off with Hermes",
			problem_error_body: "Hermes answered with an error. Try again in a moment.",
			retry: "Try again",
			checking: "Checking…",
			pair_again: "Pair again",
			open_youtube: "Open YouTube",
			seen_last: "Hermes last answered {when}",
			queue_label: "Unsubscribe queue",
			queue_waiting_one: "{count} approved unsubscribe is waiting",
			queue_waiting_other: "{count} approved unsubscribes are waiting",
			queue_waiting_changes_one: "{count} approved change is waiting",
			queue_waiting_changes_other: "{count} approved changes are waiting",
			queue_waiting_note: "Nothing changes on YouTube until you click Run now. A YouTube tab then opens and stays in view.",
			queue_waiting_more: "and {count} more",
			queue_waiting_resubscribe_item: "Resubscribe: {channel}",
			queue_run_now: "Run now",
			queue_not_now: "Not now",
			queue_starting: "Starting the approved queue…",
			queue_running_unsubscribe: "Cancelling {index} of {total} · {channel}",
			queue_running_resubscribe: "Resubscribing {index} of {total} · {channel}",
			queue_running_note: "Only what you approved in Hermes. A YouTube tab stays in view and closes by itself.",
			queue_stop: "Stop",
			queue_stopping: "Stopping after the current channel…",
			queue_stopped: "Queue stopped",
			queue_stopped_one: "Queue stopped · {count} left",
			queue_stopped_other: "Queue stopped · {count} left",
			queue_stopped_note: "Nothing else changes until you resume.",
			queue_stopped_tab: "The queue tab was closed, so the queue stopped. Nothing else changes until you resume.",
			queue_resume: "Resume",
			queue_resuming: "Resuming the queue…",
			queue_resuming_note: "It continues only with what you approved in Hermes.",
			queue_held_logged_out_title: "Queue on hold: you're signed out of YouTube",
			queue_held_logged_out_body: "Sign in to your YouTube account in this browser, then click Try again.",
			queue_held_challenge_title: "Queue on hold: YouTube verification",
			queue_held_challenge_body: "YouTube asked to confirm it's you. Open YouTube, complete the check, then click Try again.",
			queue_held_failures_title: "Queue on hold: two failures in a row",
			queue_held_failures_body: "The queue stopped so it doesn't keep failing. Check the channel on YouTube, then click Try again.",
			queue_held_cap_title: "Paused after {count} channels",
			queue_held_cap_body: "A short break between batches, so YouTube isn't rushed.",
			queue_held_until: "It tries again by itself {when}.",
			queue_held_cap_until: "It continues by itself {when}.",
			queue_retry: "Try again",
			queue_continue_now: "Continue now",
			queue_done_unsubscribe_one: "{count} unsubscribed",
			queue_done_unsubscribe_other: "{count} unsubscribed",
			queue_done_resubscribe_one: "{count} resubscribed",
			queue_done_resubscribe_other: "{count} resubscribed",
			queue_failed_one: "{count} failed",
			queue_failed_other: "{count} failed",
			queue_finished: "Finished {when}.",
			queue_err: "The extension didn't respond. Try again.",
			queue_reason_button_not_found: "The subscribe button didn't show up on the channel page.",
			queue_reason_confirm_not_found: "YouTube's confirmation didn't show up.",
			queue_reason_state_unchanged: "The button didn't change after the click; the next sync will check.",
			queue_reason_wrong_channel: "The page that opened wasn't this channel; nothing was clicked.",
			queue_reason_logged_out: "Signed out of YouTube.",
			queue_reason_challenge: "YouTube asked for a verification.",
			queue_reason_timeout: "YouTube took too long to respond.",
			queue_reason_stopped: "Stopped by you before the click.",
			queue_reason_interrupted: "The extension was interrupted midway; nothing is retried on its own.",
			queue_reason_tab_closed: "The tab was closed before the end.",
			queue_reason_invalid_item: "Invalid item; nothing was done.",
			queue_reason_page_error: "The YouTube page looked different than expected.",
			queue_reason_other: "Something unexpected happened on the page."
		},
		sync: {
			running: "Syncing subscriptions…",
			done_complete: "Subscriptions synced ({count} channels)",
			done_partial: "Partly synced ({count} channels); nothing was marked as unsubscribed",
			error_invalid: "Hermes rejected the list (extension bug); it will not be resent",
			error_unauthorized: "Hermes did not accept this browser. Pair again.",
			error_ext_endpoint_down: "Open Hermes to sync; the list will be sent when it is back",
			error_timeout: "Hermes took too long; the list will be sent again",
			error_tab_closed: "The subscriptions tab was closed before the end",
			error_tab_timeout: "YouTube took too long to load your subscriptions",
			error_scrape_failed: "Could not read your subscriptions on YouTube",
			error_nothing_to_send: "No subscriptions found. Are you signed in to YouTube?",
			error_logged_out: "Sign in to YouTube in this browser to sync your subscriptions",
			error_other: "Sync failed",
			done_partial_needs_visible: "Partly synced ({count} channels): YouTube did not load the whole list in the background. Use \"Sync now\" to read it all",
			error_cancelled: "Sync cancelled; nothing was sent",
			overlay_title: "Hermes is reading your subscriptions",
			overlay_count: "Channels read: {count}",
			overlay_safe: "Read-only: nothing is changed in your YouTube account.",
			overlay_keep: "Keep this tab in view; it closes by itself when done.",
			overlay_cancel: "Cancel"
		},
		queue: {
			overlay_title_unsubscribe: "Hermes is cancelling subscriptions you approved",
			overlay_title_resubscribe: "Hermes is resubscribing to channels you approved",
			progress_unsubscribe: "Cancelling {index} of {total} · {channel}",
			progress_resubscribe: "Resubscribing {index} of {total} · {channel}",
			overlay_note: "Only items you approved in Hermes. Keep this tab in view; it closes by itself.",
			overlay_stop: "Stop",
			overlay_stopped: "Stopping. Nothing else will be changed.",
			overlay_result_done: "Done · {channel}",
			overlay_result_failed: "Skipped · {channel} ({reason})",
			status_starting: "Starting the approved queue…",
			status_idle: "Queue: {done} done, {failed} failed",
			status_stopped: "Queue stopped by you. Resume it in the extension popup.",
			status_paused_logged_out: "Sign in to YouTube in this browser to continue the queue",
			status_paused_challenge: "YouTube asked for a verification; the queue is paused for a few hours",
			status_paused_failures: "Paused after 2 failures in a row; it will try again later",
			status_paused_cap: "Paused after {count} items; it continues in a few minutes",
			reason_none: "",
			reason_not_subscribed: "already not subscribed",
			reason_already_subscribed: "already subscribed",
			reason_button_not_found: "subscribe button not found",
			reason_confirm_not_found: "confirmation did not appear",
			reason_state_unchanged: "the button did not change",
			reason_wrong_channel: "the page is not this channel",
			reason_logged_out: "signed out of YouTube",
			reason_challenge: "YouTube asked for a verification",
			reason_timeout: "took too long",
			reason_stopped: "stopped",
			reason_interrupted: "interrupted",
			reason_tab_closed: "tab closed",
			reason_invalid_item: "invalid item",
			reason_page_error: "unexpected page"
		},
		search: {},
		sidebar: {
			title: "HermesTube",
			tree_label: "HermesTube tabs and folders",
			refreshing: "Checking for new videos…",
			new_count_one: "{count} new",
			new_count_other: "{count} new",
			none_new: "Nothing new",
			empty_hint: "Organize your channels into folders in Hermes",
			disconnected: "Open Hermes to reconnect",
			unauthorized: "Hermes no longer accepts this browser. Pair again from the extension icon.",
			conn_error: "Hermes is not answering right now",
			expand: "Expand",
			collapse: "Collapse",
			back: "Back",
			close: "Close",
			mark_read: "Mark as read",
			marked_read: "Marked as read",
			undo: "Undo",
			mark_failed: "Couldn't mark as read. Try again in a moment.",
			load_more: "Load more",
			more_error: "Couldn't load more",
			feed_empty: "Nothing new here",
			feed_empty_hint: "New videos from these channels will show up here.",
			feed_error: "Couldn't load the videos",
			feed_error_hint: "Check that Hermes is open.",
			retry: "Try again"
		},
		home: {}
	},
	"pt-BR": {
		common: {
			reconnect_open_hermes: "Abra o Hermes para reconectar",
			unpaired: "Ainda não conectado ao Hermes",
			unauthorized: "O Hermes não aceitou este navegador. Pareie de novo.",
			connected: "Conectado ao Hermes",
			connected_port: "Conectado ao Hermes (porta {port})",
			timeout: "O Hermes demorou demais para responder",
			error: "Algo deu errado na conversa com o Hermes",
			invalid_response: "Resposta inesperada do Hermes",
			server_unverified: "O programa que respondeu nesta porta não provou que é o seu Hermes, então a extensão não enviou nada. Abra o Hermes ou pareie de novo.",
			server_outdated: "O Hermes precisa de uma versão mais nova do plugin HermesTube para parear com esta extensão.",
			code_mismatch: "O código não bateu com o que o Hermes está mostrando."
		},
		popup: {
			app_name: "Hermes · Inscrições",
			loading: "Carregando…",
			pill_connected: "Conectado",
			pill_checking: "Verificando…",
			pill_unpaired: "Não conectado",
			pill_reconnect_needed: "Hermes fechado",
			pill_unauthorized: "Pareamento recusado",
			pill_error: "Com problema",
			tagline: "Conecte este navegador ao Hermes para organizar suas inscrições do YouTube.",
			code_label: "Código de pareamento",
			code_hint: "6 dígitos, mostrados no Hermes. Dá para colar.",
			connect: "Conectar",
			pairing: "Procurando o Hermes…",
			where_code: "Onde acho o código?",
			where_step1: "Abra o Hermes Desktop.",
			where_step2: "Entre na página do plugin (inscrições do YouTube).",
			where_step3: "Clique em “Conectar extensão”. Aparece um código de 6 dígitos, que vale por 5 minutos.",
			advanced: "Avançado",
			address_label: "Endereço do Hermes",
			address_placeholder: "automático",
			address_hint: "Deixe vazio: a extensão acha o Hermes sozinha neste computador.",
			address_invalid: "Use um endereço deste computador, como http://127.0.0.1:47615",
			err_invalid_code_one: "Código errado. Resta {count} tentativa.",
			err_invalid_code_other: "Código errado. Restam {count} tentativas.",
			err_invalid_code: "Código errado. Confira os dígitos no Hermes.",
			err_expired: "Esse código expirou (cada código vale 5 minutos). Gere um novo no Hermes.",
			err_used: "Esse código já foi usado. Gere um novo no Hermes.",
			err_locked: "Muitas tentativas erradas: o código foi bloqueado. Gere um novo no Hermes.",
			err_no_active_code: "O Hermes está aberto, mas sem código ativo. Clique em “Conectar extensão” na página do plugin.",
			err_ext_endpoint_down: "Não achei o Hermes neste computador. Abra o Hermes e a página do plugin, e tente de novo.",
			err_invalid: "O código tem 6 dígitos.",
			err_timeout: "O Hermes demorou para responder. Tente de novo.",
			err_plugin_disabled: "O plugin está desligado no Hermes. Ligue-o e tente de novo.",
			err_refused: "O Hermes recusou este navegador. Gere um código novo e tente de novo.",
			err_other: "Não deu para conectar. Tente de novo.",
			err_server_unverified: "Outro programa neste computador respondeu no lugar do Hermes, então o código não foi usado. Abra o Hermes Desktop na tela de pareamento e tente de novo.",
			err_server_outdated: "Atualize o plugin HermesTube no Hermes e pareie de novo.",
			this_browser: "Este navegador",
			paired_on: "Pareado em {date}",
			seen: "Hermes respondeu {when}",
			details: "Detalhes",
			details_address: "Endereço: {address}",
			details_device: "Aparelho: {id}",
			just_now: "agora mesmo",
			last_sync: "Última sincronização",
			sync_never: "Ainda não sincronizado.",
			sync_channels_one: "{count} canal",
			sync_channels_other: "{count} canais",
			sync_complete: "lista completa",
			sync_partial: "parcial",
			sync_partial_note: "Lista parcial: nenhuma inscrição foi marcada como cancelada.",
			sync_last_ok: "Última vez que deu certo: {when}.",
			sync_never_ok: "Ainda não deu certo nenhuma vez.",
			needs_visible: "Precisa de uma sincronização visível: em segundo plano o YouTube não carregou a lista inteira. Clique em “Sincronizar agora”.",
			reason_scroll_stalled: "O YouTube parou de carregar a lista antes do fim.",
			reason_timeout: "Ler a lista demorou demais.",
			reason_logged_out: "Parece que você não está logado no YouTube.",
			reason_missing_ids: "Alguns canais não foram identificados e ficaram de fora.",
			reason_too_many: "Mais de 5000 canais: só os primeiros foram enviados.",
			reason_stale: "A lista foi enviada com atraso, então vale como parcial.",
			reason_cancelled: "A leitura foi cancelada.",
			reason_aborted: "A leitura foi interrompida.",
			reason_empty: "A página de inscrições veio vazia.",
			reason_server_partial: "Muitos canais sumiram da lista de uma vez, então o Hermes não os marcou como cancelados. Nada mudou no YouTube.",
			reason_other: "A página do YouTube veio diferente do esperado.",
			sync_err_tab_closed: "A aba do YouTube foi fechada antes do fim.",
			sync_err_tab_timeout: "O YouTube demorou demais para carregar suas inscrições.",
			sync_err_scrape_failed: "Não deu para ler suas inscrições no YouTube.",
			sync_err_nothing_to_send: "Nenhuma inscrição encontrada na página.",
			sync_err_logged_out: "Entre no YouTube neste navegador para sincronizar.",
			sync_err_ext_endpoint_down: "O Hermes estava fechado; a lista vai quando ele voltar.",
			sync_err_timeout: "O Hermes demorou para responder; a lista será reenviada.",
			sync_err_invalid: "O Hermes recusou a lista (erro da extensão).",
			sync_err_cancelled: "Sincronização cancelada; nada foi enviado.",
			sync_err_unauthorized: "O Hermes não aceitou este navegador.",
			sync_err_not_started: "A sincronização não começou. Tente de novo.",
			sync_err_other: "A sincronização falhou.",
			sync_now: "Sincronizar agora",
			syncing: "Lendo suas inscrições no YouTube…",
			syncing_since: "Começou {when}.",
			syncing_note: "Uma aba do YouTube fica aberta enquanto isso. Nada muda na sua conta.",
			open_hermes: "Abrir no Hermes",
			disconnect: "Desconectar",
			disconnect_title: "Desconectar este navegador?",
			disconnect_body: "O Hermes para de receber suas inscrições daqui, e o que a extensão guardou neste navegador é apagado. Nada muda no YouTube.",
			cancel: "Cancelar",
			disconnect_yes: "Desconectar",
			disconnecting: "Desconectando…",
			problem_closed_title: "O Hermes está fechado",
			problem_closed_body: "Abra o Hermes e a página do plugin. A extensão reconecta sozinha.",
			problem_unauthorized_title: "O Hermes não reconhece mais este navegador",
			problem_unauthorized_body: "O pareamento foi desfeito no Hermes. Pareie de novo com um código novo.",
			problem_logged_out_title: "Entre no YouTube",
			problem_logged_out_body: "Para ler suas inscrições, entre na sua conta do YouTube neste navegador. Depois, sincronize de novo.",
			problem_error_title: "Algo não vai bem com o Hermes",
			problem_error_body: "O Hermes respondeu com um erro. Tente de novo daqui a pouco.",
			retry: "Tentar de novo",
			checking: "Verificando…",
			pair_again: "Parear de novo",
			open_youtube: "Abrir o YouTube",
			seen_last: "Última resposta do Hermes {when}",
			queue_label: "Fila de cancelamento",
			queue_waiting_one: "{count} cancelamento aprovado está esperando",
			queue_waiting_other: "{count} cancelamentos aprovados estão esperando",
			queue_waiting_changes_one: "{count} alteração aprovada está esperando",
			queue_waiting_changes_other: "{count} alterações aprovadas estão esperando",
			queue_waiting_note: "Nada muda no YouTube até você clicar em Executar agora. Aí uma aba do YouTube abre e fica à vista.",
			queue_waiting_more: "e mais {count}",
			queue_waiting_resubscribe_item: "Reinscrever: {channel}",
			queue_run_now: "Executar agora",
			queue_not_now: "Agora não",
			queue_starting: "Começando a fila aprovada…",
			queue_running_unsubscribe: "Cancelando {index} de {total} · {channel}",
			queue_running_resubscribe: "Reinscrevendo {index} de {total} · {channel}",
			queue_running_note: "Só o que você aprovou no Hermes. Uma aba do YouTube fica à vista e fecha sozinha.",
			queue_stop: "Parar",
			queue_stopping: "Parando depois do canal atual…",
			queue_stopped: "Fila parada",
			queue_stopped_one: "Fila parada · {count} restante",
			queue_stopped_other: "Fila parada · {count} restantes",
			queue_stopped_note: "Nada mais é alterado até você retomar.",
			queue_stopped_tab: "A aba da fila foi fechada, então a fila parou. Nada mais é alterado até você retomar.",
			queue_resume: "Retomar",
			queue_resuming: "Retomando a fila…",
			queue_resuming_note: "Continua só com o que você aprovou no Hermes.",
			queue_held_logged_out_title: "Fila em espera: você saiu da conta do YouTube",
			queue_held_logged_out_body: "Entre na sua conta do YouTube neste navegador e clique em Tentar de novo.",
			queue_held_challenge_title: "Fila em espera: verificação do YouTube",
			queue_held_challenge_body: "O YouTube pediu para confirmar que é você. Abra o YouTube, resolva a verificação e clique em Tentar de novo.",
			queue_held_failures_title: "Fila em espera: duas falhas seguidas",
			queue_held_failures_body: "A fila parou para não insistir no erro. Confira o canal no YouTube e clique em Tentar de novo.",
			queue_held_cap_title: "Pausa depois de {count} canais",
			queue_held_cap_body: "Um intervalo curto entre lotes, para não apressar o YouTube.",
			queue_held_until: "Tenta sozinha {when}.",
			queue_held_cap_until: "Continua sozinha {when}.",
			queue_retry: "Tentar de novo",
			queue_continue_now: "Continuar agora",
			queue_done_unsubscribe_one: "{count} cancelada",
			queue_done_unsubscribe_other: "{count} canceladas",
			queue_done_resubscribe_one: "{count} reinscrição",
			queue_done_resubscribe_other: "{count} reinscrições",
			queue_failed_one: "{count} falhou",
			queue_failed_other: "{count} falharam",
			queue_finished: "Terminou {when}.",
			queue_err: "A extensão não respondeu. Tente de novo.",
			queue_reason_button_not_found: "O botão de inscrição não apareceu na página do canal.",
			queue_reason_confirm_not_found: "A confirmação do YouTube não apareceu.",
			queue_reason_state_unchanged: "O botão não mudou depois do clique; a próxima sincronização confere.",
			queue_reason_wrong_channel: "A página aberta não era deste canal; nada foi clicado.",
			queue_reason_logged_out: "Fora da conta do YouTube.",
			queue_reason_challenge: "O YouTube pediu uma verificação.",
			queue_reason_timeout: "O YouTube demorou demais para responder.",
			queue_reason_stopped: "Parado por você antes do clique.",
			queue_reason_interrupted: "A extensão foi interrompida no meio; nada é repetido sozinho.",
			queue_reason_tab_closed: "A aba foi fechada antes do fim.",
			queue_reason_invalid_item: "Item inválido; nada foi feito.",
			queue_reason_page_error: "A página do YouTube estava diferente do esperado.",
			queue_reason_other: "Algo inesperado aconteceu na página."
		},
		sync: {
			running: "Sincronizando inscrições…",
			done_complete: "Inscrições sincronizadas ({count} canais)",
			done_partial: "Sincronização parcial ({count} canais); nenhuma inscrição foi marcada como cancelada",
			error_invalid: "O Hermes recusou a lista (bug da extensão); ela não será reenviada",
			error_unauthorized: "O Hermes não aceitou este navegador. Pareie de novo.",
			error_ext_endpoint_down: "Abra o Hermes para sincronizar; a lista vai quando ele voltar",
			error_timeout: "O Hermes demorou demais; a lista será reenviada",
			error_tab_closed: "A aba de inscrições foi fechada antes do fim",
			error_tab_timeout: "O YouTube demorou demais para carregar suas inscrições",
			error_scrape_failed: "Não deu para ler suas inscrições no YouTube",
			error_nothing_to_send: "Nenhuma inscrição encontrada. Você está logado no YouTube?",
			error_logged_out: "Entre no YouTube neste navegador para sincronizar suas inscrições",
			error_other: "A sincronização falhou",
			done_partial_needs_visible: "Sincronização parcial ({count} canais): em segundo plano o YouTube não carregou a lista inteira. Use \"Sincronizar agora\" para ler tudo",
			error_cancelled: "Sincronização cancelada; nada foi enviado",
			overlay_title: "Hermes está lendo suas inscrições",
			overlay_count: "Canais lidos: {count}",
			overlay_safe: "Só leitura: nada é alterado na sua conta do YouTube.",
			overlay_keep: "Deixe esta aba à vista; ela fecha sozinha ao terminar.",
			overlay_cancel: "Cancelar"
		},
		queue: {
			overlay_title_unsubscribe: "Hermes está cancelando inscrições que você aprovou",
			overlay_title_resubscribe: "Hermes está reinscrevendo em canais que você aprovou",
			progress_unsubscribe: "cancelando {index} de {total} · {channel}",
			progress_resubscribe: "reinscrevendo {index} de {total} · {channel}",
			overlay_note: "Só itens que você aprovou no Hermes. Deixe esta aba à vista; ela fecha sozinha.",
			overlay_stop: "Parar",
			overlay_stopped: "Parando. Nada mais será alterado.",
			overlay_result_done: "Feito · {channel}",
			overlay_result_failed: "Pulado · {channel} ({reason})",
			status_starting: "Começando a fila aprovada…",
			status_idle: "Fila: {done} feitos, {failed} com falha",
			status_stopped: "Fila parada por você. Retome pelo popup da extensão.",
			status_paused_logged_out: "Entre no YouTube neste navegador para continuar a fila",
			status_paused_challenge: "O YouTube pediu uma verificação; a fila fica pausada por algumas horas",
			status_paused_failures: "Pausada depois de 2 falhas seguidas; tenta de novo mais tarde",
			status_paused_cap: "Pausada depois de {count} itens; continua em alguns minutos",
			reason_none: "",
			reason_not_subscribed: "já não estava inscrito",
			reason_already_subscribed: "já estava inscrito",
			reason_button_not_found: "botão de inscrição não encontrado",
			reason_confirm_not_found: "a confirmação não apareceu",
			reason_state_unchanged: "o botão não mudou",
			reason_wrong_channel: "a página não é deste canal",
			reason_logged_out: "fora da conta do YouTube",
			reason_challenge: "o YouTube pediu uma verificação",
			reason_timeout: "demorou demais",
			reason_stopped: "parado",
			reason_interrupted: "interrompido",
			reason_tab_closed: "aba fechada",
			reason_invalid_item: "item inválido",
			reason_page_error: "página inesperada"
		},
		search: {},
		sidebar: {
			title: "HermesTube",
			tree_label: "Abas e pastas do HermesTube",
			refreshing: "Procurando vídeos novos…",
			new_count_one: "{count} novo",
			new_count_other: "{count} novos",
			none_new: "Nada novo",
			empty_hint: "Organize seus canais em pastas no Hermes",
			disconnected: "Abra o Hermes para reconectar",
			unauthorized: "O Hermes não aceita mais este navegador. Pareie de novo pelo ícone da extensão.",
			conn_error: "O Hermes não está respondendo agora",
			expand: "Abrir",
			collapse: "Fechar",
			back: "Voltar",
			close: "Fechar",
			mark_read: "Marcar como lido",
			marked_read: "Marcado como lido",
			undo: "Desfazer",
			mark_failed: "Não deu para marcar como lido. Tente de novo daqui a pouco.",
			load_more: "Carregar mais",
			more_error: "Não deu para carregar mais",
			feed_empty: "Nada novo aqui",
			feed_empty_hint: "Os vídeos novos destes canais aparecem aqui.",
			feed_error: "Não deu para carregar os vídeos",
			feed_error_hint: "Confira se o Hermes está aberto.",
			retry: "Tentar de novo"
		},
		home: {}
	}
};
function pickLanguage(tag) {
	return tag && /^pt(-|_|$)/i.test(tag) ? "pt-BR" : "en";
}
var browserLanguage = () => typeof navigator === "undefined" ? void 0 : navigator.language;
var current = pickLanguage(browserLanguage());
/** `ExtState.language` is `auto` when the user has not chosen: then the browser language applies. */
function setLanguage(tag) {
	current = pickLanguage(!tag || tag === "auto" ? browserLanguage() : tag);
	return current;
}
function getLanguage() {
	return current;
}
/** Text for the key in the current language; falls back to en and then to the key itself. `{name}` is interpolated. */
function t(ns, key, vars) {
	const raw = CATALOGS[current][ns][key] ?? CATALOGS.en[ns][key] ?? key;
	if (!vars) return raw;
	return raw.replace(/\{(\w+)\}/g, (m, name) => name in vars ? String(vars[name]) : m);
}
(BigInt(`0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF`) - 1n) / 2n;
new TextEncoder();
// extension/src/background/pairing.ts
/** `{device_name, paired_at}` of the current pairing (the popup shows the name). */
var PAIR_INFO_KEY = STORAGE_KEYS.pairInfo;
/** Port chosen in the popup's "advanced" section (absent = automatic discovery). */
var PAIR_PORT_KEY = STORAGE_KEYS.pairPort;
/** Only the digits 0–9 of the text (pasting "481-516", "481 516", "Code: 481516"), at most 6. */
function normalizeCode(raw) {
	return (raw ?? "").replace(/[^0-9]/g, "").slice(0, 6);
}
/**
* "Advanced" address: empty = automatic; `47630`, `127.0.0.1:47630`, `http://127.0.0.1:47630` or `localhost`.
* Loopback only (the manifest only allows `http://127.0.0.1/*`; the server never listens outside it).
*/
function parseAddress(raw) {
	const s = (raw ?? "").trim();
	if (!s) return {
		ok: true,
		port: null
	};
	const validPort = (n) => Number.isInteger(n) && n >= 1024 && n <= 65535 ? {
		ok: true,
		port: n
	} : { ok: false };
	if (/^\d+$/.test(s)) return validPort(Number(s));
	let url;
	try {
		url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`);
	} catch {
		return { ok: false };
	}
	if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !url.port) return { ok: false };
	if (url.pathname !== "/" || url.search || url.hash || url.username) return { ok: false };
	return validPort(Number(url.port));
}
/** "Chrome — macOS": the name Hermes shows in the device list. Nothing that identifies the person. */
function deviceName(nav = globalThis.navigator ?? {}) {
	const ua = nav.userAgent ?? "";
	const browser = nav.brave ? "Brave" : / Edg\//.test(ua) ? "Edge" : / OPR\//.test(ua) ? "Opera" : / Vivaldi\//.test(ua) ? "Vivaldi" : "Chrome";
	const os = /CrOS/.test(ua) ? "ChromeOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : null;
	return os ? `${browser} — ${os}` : browser;
}
// extension/src/lib/messaging.ts
function normalize(res, what) {
	if (isEnvelope(res)) return res;
	return fail("internal", `no answer from ${what}`);
}
async function sendRequest(type, payload) {
	try {
		return normalize(await chrome.runtime.sendMessage({
			type,
			payload
		}), "background");
	} catch (e) {
		return fail("internal", errorMessage(e));
	}
}
// extension/src/lib/queue-release.ts
var QUEUE_WAITING_KEY = "queue_waiting";
var QUEUE_RELEASE_KEY = "queue_release";
var QUEUE_SNOOZE_KEY = "queue_snooze";
function area() {
	return (globalThis.chrome?.storage)?.session ?? null;
}
var idList = (v) => Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x.length > 0 && x.length <= 200))].slice(0, 400) : [];
async function read(key) {
	const s = area();
	if (!s) return null;
	const v = (await s.get(key))[key];
	return v && typeof v === "object" ? v : null;
}
async function readWaiting() {
	const w = await read(QUEUE_WAITING_KEY);
	if (!w || !Array.isArray(w.items)) return null;
	return {
		items: w.items.filter((i) => i && typeof i.id === "string"),
		at: Number(w.at) || 0
	};
}
/** Current release; `null` when absent, empty or expired. */
async function readRelease(now = Date.now()) {
	const r = await read(QUEUE_RELEASE_KEY);
	if (!r) return null;
	const at = Number(r.at);
	const ids = idList(r.ids);
	if (!Number.isFinite(at) || now - at > 72e5 || at - now > 6e4 || ids.length === 0) return null;
	return {
		ids,
		at
	};
}
/** "Run now" (popup only): releases these ids, on top of what is still released. */
async function releaseQueue(ids, now = Date.now()) {
	const s = area();
	if (!s) return;
	const next = {
		ids: idList([...(await readRelease(now))?.ids ?? [], ...ids]),
		at: now
	};
	await s.set({ [QUEUE_RELEASE_KEY]: next });
}
/** "Not now" (popup only). */
async function snoozeQueue(ids, now = Date.now()) {
	const s = area();
	if (!s) return;
	const prev = await read(QUEUE_SNOOZE_KEY);
	await s.set({ [QUEUE_SNOOZE_KEY]: {
		ids: idList([...idList(prev?.ids), ...ids]),
		at: now
	} });
}
async function readSnooze() {
	return idList((await read(QUEUE_SNOOZE_KEY))?.ids);
}
/** Items that still need a click (not released, not snoozed). */
function unreleased(w, release, snoozed = []) {
	const skip = /* @__PURE__ */ new Set([...release?.ids ?? [], ...snoozed]);
	return (w?.items ?? []).filter((i) => !skip.has(i.id));
}
// extension/src/popup/text.ts
var p = (key, vars) => t("popup", key, vars);
/** `key_one` / `key_other` by number (zero uses `other`: "0 channels"). */
function plural(key, count, vars = {}) {
	return p(`${key}_${count !== 0 && new Intl.PluralRules(getLanguage()).select(count) === "one" ? "one" : "other"}`, {
		count,
		...vars
	});
}
/** "5 minutes ago", "the day before yesterday", "just now"; very old → date. */
function relTime(ms, now) {
	const diffS = (ms - now) / 1e3;
	const abs = Math.abs(diffS);
	if (abs < 45) return p("just_now");
	const rtf = new Intl.RelativeTimeFormat(getLanguage(), { numeric: "auto" });
	if (abs < 2700) return rtf.format(Math.round(diffS / 60), "minute");
	if (abs < 79200) return rtf.format(Math.round(diffS / 3600), "hour");
	if (abs < 2246400) return rtf.format(Math.round(diffS / 86400), "day");
	return shortDate(ms);
}
function shortDate(ms) {
	return new Intl.DateTimeFormat(getLanguage(), {
		day: "numeric",
		month: "short",
		year: "numeric"
	}).format(new Date(ms));
}
var PAIR_ERRORS = /* @__PURE__ */ new Set([
	"expired",
	"used",
	"locked",
	"no_active_code",
	"ext_endpoint_down",
	"invalid",
	"timeout",
	"plugin_disabled"
]);
var REFUSED = /* @__PURE__ */ new Set([
	"origin_forbidden",
	"origin_required",
	"origin_mismatch",
	"host_forbidden",
	"unauthorized"
]);
/** Text for each `pair.submit` failure (`error.code` = reason; `invalid_code` carries `details.remaining`). */
function pairErrorText(err) {
	const code = err.code;
	if (err.reason === "server_outdated") return p("err_server_outdated");
	if (err.reason === "server_unverified" && code !== "invalid_code") return p("err_server_unverified");
	if (code === "invalid_code") {
		const remaining = err.details?.remaining;
		if (typeof remaining === "number" && Number.isFinite(remaining)) {
			if (remaining <= 0) return p("err_locked");
			return plural("err_invalid_code", remaining);
		}
		return p("err_invalid_code");
	}
	if (PAIR_ERRORS.has(code)) return p(`err_${code}`);
	if (REFUSED.has(code)) return p("err_refused");
	return p("err_other");
}
var SYNC_ERRORS = /* @__PURE__ */ new Set([
	"tab_closed",
	"tab_timeout",
	"scrape_failed",
	"nothing_to_send",
	"logged_out",
	"ext_endpoint_down",
	"timeout",
	"invalid",
	"cancelled",
	"unauthorized",
	"not_started"
]);
var REASONS = /* @__PURE__ */ new Set([
	"scroll_stalled",
	"timeout",
	"logged_out",
	"missing_ids",
	"too_many",
	"stale",
	"cancelled",
	"aborted",
	"empty",
	"server_partial"
]);
function reasonText(reason) {
	if (!reason) return null;
	return REASONS.has(reason) ? p(`reason_${reason}`) : p("reason_other");
}
function syncErrorText(code) {
	return code && SYNC_ERRORS.has(code) ? p(`sync_err_${code}`) : p("sync_err_other");
}
/** Not logged in to YouTube: becomes the popup's "problem" state. */
function isLoggedOut(s) {
	return Boolean(s && s.state === "error" && (s.error?.code === "logged_out" || s.reason === "logged_out"));
}
function isRunning(s, now) {
	return Boolean(s && s.state === "running" && now - s.started_at < 6e5);
}
/** Summary of the last sync: when, how many channels, signal and the reason in plain language. */
function syncLines(s, now) {
	const lastOk = s?.last_ok_at ?? null;
	if (!s || s.state === "running") return {
		main: lastOk ? p("sync_last_ok", { when: relTime(lastOk, now) }) : p("sync_never"),
		notes: []
	};
	if (s.state === "ok") {
		const when = relTime(s.finished_at ?? lastOk ?? s.started_at, now);
		const signal = s.signal === "complete" ? p("sync_complete") : p("sync_partial");
		const main = [
			when,
			plural("sync_channels", s.sent),
			signal
		].join(" · ");
		const notes = [];
		if (s.signal !== "complete") {
			if (s.needs_visible) notes.push(p("needs_visible"));
			else {
				const r = reasonText(s.reason);
				if (r) notes.push(r);
			}
			notes.push(p("sync_partial_note"));
		}
		return {
			main,
			notes
		};
	}
	const notes = [];
	const r = s.error?.code === "nothing_to_send" ? reasonText(s.reason) : null;
	if (r) notes.push(r);
	notes.push(lastOk ? p("sync_last_ok", { when: relTime(lastOk, now) }) : p("sync_never_ok"));
	return {
		main: syncErrorText(s.error?.code),
		notes
	};
}
function waitingView(items) {
	const count = items.length;
	const allUnsub = items.every((i) => i.action === "unsubscribe");
	const lines = items.slice(0, 5).map((i) => {
		const channel = i.channel_title || i.channel_id;
		return i.action === "resubscribe" ? p("queue_waiting_resubscribe_item", { channel }) : channel;
	});
	if (count > 5) lines.push(p("queue_waiting_more", { count: count - 5 }));
	return {
		state: "waiting",
		heading: null,
		line: plural(allUnsub ? "queue_waiting" : "queue_waiting_changes", count),
		notes: [p("queue_waiting_note")],
		failures: [],
		holdReason: null,
		channels: lines,
		ids: items.map((i) => i.id)
	};
}
var FAIL_REASONS = /* @__PURE__ */ new Set([
	"button_not_found",
	"confirm_not_found",
	"state_unchanged",
	"wrong_channel",
	"logged_out",
	"challenge",
	"timeout",
	"stopped",
	"interrupted",
	"tab_closed",
	"invalid_item",
	"page_error"
]);
/** Stable executor reason → human sentence. */
function queueReasonText(reason) {
	return p(`queue_reason_${reason && FAIL_REASONS.has(reason) ? reason : "other"}`);
}
function progressLine(run) {
	const channel = run.channel_title || run.channel_id || "";
	if (!run.action || run.index <= 0) return p("queue_starting");
	return p(`queue_running_${run.action === "resubscribe" ? "resubscribe" : "unsubscribe"}`, {
		index: run.index,
		total: Math.max(run.total, run.index),
		channel
	});
}
/** How many are left: the server's count, if newer than the round; otherwise what remains of the round. */
function remaining(run, pending) {
	if (pending && Number.isFinite(pending.count) && pending.at >= run.updated_at) return Math.max(0, pending.count);
	return Math.max(0, run.total - run.index);
}
/** Failures of this round (ledger from its start), grouped by reason, in the order they happened. */
function failuresOf(run, ledger) {
	const since = run.started_at ?? Number.POSITIVE_INFINITY;
	const reasons = Object.values(ledger ?? {}).filter((e) => e && e.status === "failed" && typeof e.at === "number" && e.at >= since).sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).map((e) => e.error ?? null);
	if (reasons.length === 0 && run.last?.status === "failed") reasons.push(run.last.error);
	const counts = /* @__PURE__ */ new Map();
	for (const r of reasons) {
		const text = queueReasonText(r);
		counts.set(text, (counts.get(text) ?? 0) + 1);
	}
	return [...counts].map(([text, n]) => n > 1 ? `${n} × ${text}` : text);
}
function queueView(i) {
	const run = i.run && typeof i.run === "object" ? i.run : null;
	const base = {
		heading: null,
		notes: [],
		failures: [],
		holdReason: null
	};
	if (run?.state === "running") {
		if (i.stopRequested || i.ctl?.stopped) return {
			...base,
			state: "stopping",
			line: progressLine(run),
			notes: [p("queue_stopping")]
		};
		return {
			...base,
			state: "running",
			line: progressLine(run),
			notes: [p("queue_running_note")]
		};
	}
	if (i.resuming) return {
		...base,
		state: "resuming",
		line: p("queue_resuming"),
		notes: [p("queue_resuming_note")]
	};
	if (i.waiting?.length) return waitingView(i.waiting);
	if (!run) return null;
	if (run.state === "stopped") {
		const left = remaining(run, i.pending);
		return {
			...base,
			state: "stopped",
			line: left > 0 ? plural("queue_stopped", left) : p("queue_stopped"),
			notes: [p(i.ctl?.by === "tab" ? "queue_stopped_tab" : "queue_stopped_note")]
		};
	}
	const hold = run.hold_reason;
	if (run.state === "paused" && hold && typeof run.hold_until === "number" && run.hold_until > i.now) {
		const when = relTime(run.hold_until, i.now);
		return {
			state: "held",
			holdReason: hold,
			heading: p(`queue_held_${hold}_title`, { count: Math.max(run.index, run.done + run.failed) }),
			line: p(`queue_held_${hold}_body`),
			notes: [p(hold === "cap" ? "queue_held_cap_until" : "queue_held_until", { when })],
			failures: hold === "failures" ? failuresOf(run, null).slice(-1) : []
		};
	}
	if (run.done + run.failed > 0 && i.now - run.updated_at < 864e5) {
		const parts = [];
		if (run.done > 0) parts.push(plural(`queue_done_${run.action === "resubscribe" ? "resubscribe" : "unsubscribe"}`, run.done));
		if (run.failed > 0) parts.push(plural("queue_failed", run.failed));
		return {
			...base,
			state: "done",
			line: parts.join(" · "),
			notes: [p("queue_finished", { when: relTime(run.updated_at, i.now) })],
			failures: run.failed > 0 ? failuresOf(run, i.ledger) : []
		};
	}
	return null;
}
// node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js
var f = 0;
Array.isArray;
function u(e, t, n, o, i, u) {
	t || (t = {});
	var a, c, p = t;
	if ("ref" in p) for (c in p = {}, t) "ref" == c ? a = t[c] : p[c] = t[c];
	var l = {
		type: e,
		props: p,
		key: n,
		ref: a,
		__k: null,
		__: null,
		__b: 0,
		__e: null,
		__c: null,
		constructor: void 0,
		__v: --f,
		__i: -1,
		__u: 0,
		__source: i,
		__self: u
	};
	if ("function" == typeof e && (a = e.defaultProps)) for (c in a) void 0 === p[c] && (p[c] = a[c]);
	return l$1.vnode && l$1.vnode(l), l;
}
// extension/src/popup/views.tsx
var svg = (d) => /* @__PURE__ */ u("svg", {
	class: "icon",
	viewBox: "0 0 24 24",
	width: "20",
	height: "20",
	"aria-hidden": "true",
	focusable: "false",
	fill: "none",
	stroke: "currentColor",
	"stroke-width": "1.6",
	"stroke-linecap": "round",
	"stroke-linejoin": "round",
	children: d
});
var Icons = {
	mark: () => svg(/* @__PURE__ */ u(S, { children: [/* @__PURE__ */ u("rect", {
		x: "3",
		y: "5",
		width: "18",
		height: "14",
		rx: "3"
	}), /* @__PURE__ */ u("path", {
		d: "M10.5 9.5v5l4-2.5z",
		fill: "currentColor",
		stroke: "none"
	})] })),
	plug: () => svg(/* @__PURE__ */ u(S, { children: [
		/* @__PURE__ */ u("path", { d: "M9 7V3M15 7V3" }),
		/* @__PURE__ */ u("path", { d: "M7 7h10v4a5 5 0 0 1-10 0z" }),
		/* @__PURE__ */ u("path", { d: "M12 16v5" })
	] })),
	key: () => svg(/* @__PURE__ */ u(S, { children: [/* @__PURE__ */ u("circle", {
		cx: "8",
		cy: "15",
		r: "4"
	}), /* @__PURE__ */ u("path", { d: "M11 12l9-9M17 6l3 3M15 8l2 2" })] })),
	user: () => svg(/* @__PURE__ */ u(S, { children: [/* @__PURE__ */ u("circle", {
		cx: "12",
		cy: "8",
		r: "4"
	}), /* @__PURE__ */ u("path", { d: "M4 21a8 8 0 0 1 16 0" })] })),
	alert: () => svg(/* @__PURE__ */ u(S, { children: [/* @__PURE__ */ u("path", { d: "M12 3l9.5 17h-19z" }), /* @__PURE__ */ u("path", { d: "M12 10v4M12 17.5v.01" })] })),
	external: () => svg(/* @__PURE__ */ u(S, { children: [/* @__PURE__ */ u("path", { d: "M14 4h6v6M20 4l-9 9" }), /* @__PURE__ */ u("path", { d: "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" })] }))
};
function Header({ pill }) {
	const tone = pill === "connected" ? "ok" : pill === "unpaired" || pill === "loading" || pill === "checking" ? "idle" : pill === "unauthorized" ? "bad" : "warn";
	return /* @__PURE__ */ u("header", {
		class: "top",
		children: [
			/* @__PURE__ */ u("span", {
				class: "mark",
				children: Icons.mark()
			}),
			/* @__PURE__ */ u("h1", {
				class: "title",
				children: p("app_name")
			}),
			pill !== "loading" && /* @__PURE__ */ u("span", {
				class: `pill pill-${tone}`,
				"data-testid": "conn-pill",
				children: [/* @__PURE__ */ u("span", {
					class: "dot",
					"aria-hidden": "true"
				}), p(`pill_${pill}`)]
			})
		]
	});
}
function Unpaired({ initialAddress, onSubmit }) {
	const [code, setCode] = d("");
	const [busy, setBusy] = d(false);
	const [error, setError] = d(null);
	const [address, setAddress] = d(initialAddress);
	const [addressError, setAddressError] = d(false);
	const [advancedOpen, setAdvancedOpen] = d(Boolean(initialAddress));
	const input = A(null);
	const busyRef = A(false);
	h(() => {
		input.current?.focus();
	}, []);
	async function submit(value) {
		if (busyRef.current || value.length !== 6) return;
		const parsed = parseAddress(address);
		if (!parsed.ok) {
			setAddressError(true);
			setAdvancedOpen(true);
			return;
		}
		busyRef.current = true;
		setBusy(true);
		setError(null);
		const err = await onSubmit(value, parsed.port);
		busyRef.current = false;
		setBusy(false);
		if (!err) return;
		setError(err);
		requestAnimationFrame(() => {
			input.current?.focus();
			input.current?.select();
		});
	}
	function change(raw) {
		const value = normalizeCode(raw);
		if (input.current && input.current.value !== value) input.current.value = value;
		setCode(value);
		if (error) setError(null);
		if (value.length === 6) submit(value);
	}
	const errorText = error ? pairErrorText(error) : "";
	return /* @__PURE__ */ u("section", {
		class: "pane",
		"aria-labelledby": "tagline",
		children: [
			/* @__PURE__ */ u("p", {
				id: "tagline",
				class: "lead",
				children: p("tagline")
			}),
			/* @__PURE__ */ u("form", {
				class: "code-form",
				onSubmit: (e) => {
					e.preventDefault();
					submit(code);
				},
				children: [
					/* @__PURE__ */ u("label", {
						class: "label",
						for: "code-input",
						children: p("code_label")
					}),
					/* @__PURE__ */ u("div", {
						class: "code-row",
						children: [/* @__PURE__ */ u("input", {
							ref: input,
							id: "code-input",
							"data-testid": "code-input",
							class: `code${error ? " code-error" : ""}`,
							type: "text",
							inputMode: "numeric",
							autocomplete: "one-time-code",
							spellcheck: false,
							placeholder: "000000",
							value: code,
							disabled: busy,
							"aria-invalid": error ? "true" : void 0,
							"aria-describedby": "code-hint pair-error",
							onInput: (e) => change(e.currentTarget.value),
							onPaste: (e) => {
								const pasted = e.clipboardData?.getData("text");
								if (pasted == null) return;
								e.preventDefault();
								change(pasted);
							}
						}), /* @__PURE__ */ u("button", {
							type: "submit",
							class: "btn btn-primary",
							"data-testid": "code-submit",
							disabled: busy || code.length !== 6,
							children: p("connect")
						})]
					}),
					/* @__PURE__ */ u("p", {
						id: "code-hint",
						class: "hint",
						children: p("code_hint")
					}),
					/* @__PURE__ */ u("p", {
						class: "busy",
						role: "status",
						"aria-live": "polite",
						children: busy ? /* @__PURE__ */ u(S, { children: [/* @__PURE__ */ u("span", {
							class: "spinner",
							"aria-hidden": "true"
						}), p("pairing")] }) : null
					}),
					/* @__PURE__ */ u("p", {
						id: "pair-error",
						"data-testid": "pair-error",
						class: "error",
						"aria-live": "assertive",
						"aria-atomic": "true",
						children: errorText
					})
				]
			}),
			/* @__PURE__ */ u("details", {
				class: "disclosure",
				"data-testid": "where-code",
				children: [/* @__PURE__ */ u("summary", { children: p("where_code") }), /* @__PURE__ */ u("ol", {
					class: "steps",
					children: [
						/* @__PURE__ */ u("li", { children: p("where_step1") }),
						/* @__PURE__ */ u("li", { children: p("where_step2") }),
						/* @__PURE__ */ u("li", { children: p("where_step3") })
					]
				})]
			}),
			/* @__PURE__ */ u("details", {
				class: "disclosure",
				"data-testid": "advanced",
				open: advancedOpen,
				onToggle: (e) => setAdvancedOpen(e.currentTarget.open),
				children: [/* @__PURE__ */ u("summary", { children: p("advanced") }), /* @__PURE__ */ u("div", {
					class: "field",
					children: [
						/* @__PURE__ */ u("label", {
							class: "label",
							for: "address-input",
							children: p("address_label")
						}),
						/* @__PURE__ */ u("input", {
							id: "address-input",
							"data-testid": "address-input",
							class: "text",
							type: "text",
							inputMode: "url",
							spellcheck: false,
							placeholder: p("address_placeholder"),
							value: address,
							"aria-invalid": addressError ? "true" : void 0,
							"aria-describedby": "address-hint address-error",
							onInput: (e) => {
								setAddress(e.currentTarget.value);
								setAddressError(false);
							}
						}),
						/* @__PURE__ */ u("p", {
							id: "address-hint",
							class: "hint",
							children: p("address_hint")
						}),
						/* @__PURE__ */ u("p", {
							id: "address-error",
							"data-testid": "address-error",
							class: "error",
							"aria-live": "assertive",
							children: addressError ? p("address_invalid") : ""
						})
					]
				})]
			})
		]
	});
}
function seenLine(connected, lastOkAt, now) {
	if (!lastOkAt) return null;
	if (connected) return p("seen", { when: relTime(lastOkAt, now) });
	return now - lastOkAt >= 6e4 ? p("seen_last", { when: relTime(lastOkAt, now) }) : null;
}
function Device({ name, pairedAt, lastOkAt, connected, port, deviceId, now }) {
	const meta = [pairedAt ? p("paired_on", { date: shortDate(pairedAt) }) : null, seenLine(connected, lastOkAt, now)].filter(Boolean);
	return /* @__PURE__ */ u("section", {
		class: "card device",
		"aria-labelledby": "device-label",
		children: [
			/* @__PURE__ */ u("p", {
				id: "device-label",
				class: "label",
				children: p("this_browser")
			}),
			/* @__PURE__ */ u("p", {
				class: "head",
				"data-testid": "device-name",
				children: name
			}),
			meta.length > 0 && /* @__PURE__ */ u("p", {
				class: "meta",
				children: meta.join(" · ")
			}),
			/* @__PURE__ */ u("details", {
				class: "disclosure disclosure-quiet",
				children: [/* @__PURE__ */ u("summary", { children: p("details") }), /* @__PURE__ */ u("p", {
					class: "meta mono",
					children: [
						port ? p("details_address", { address: `127.0.0.1:${port}` }) : null,
						port && deviceId ? /* @__PURE__ */ u("br", {}) : null,
						deviceId ? p("details_device", { id: deviceId }) : null
					]
				})]
			})
		]
	});
}
function SyncCard({ sync, running, startedAt, error, now, onSyncNow }) {
	const lines = syncLines(sync, now);
	return /* @__PURE__ */ u("section", {
		class: "card",
		"aria-labelledby": "sync-title",
		children: [
			/* @__PURE__ */ u("h2", {
				id: "sync-title",
				class: "label",
				children: p("last_sync")
			}),
			/* @__PURE__ */ u("div", {
				"data-testid": "sync-summary",
				class: "sync-summary",
				children: [/* @__PURE__ */ u("p", {
					class: "body",
					children: lines.main
				}), lines.notes.map((n) => /* @__PURE__ */ u("p", {
					class: "meta",
					children: n
				}, n))]
			}),
			running && /* @__PURE__ */ u("div", {
				class: "progress",
				"data-testid": "sync-progress",
				role: "status",
				"aria-live": "polite",
				children: [
					/* @__PURE__ */ u("div", {
						class: "bar",
						"aria-hidden": "true",
						children: /* @__PURE__ */ u("span", {})
					}),
					/* @__PURE__ */ u("p", {
						class: "body",
						children: p("syncing")
					}),
					/* @__PURE__ */ u("p", {
						class: "meta",
						children: [startedAt ? `${p("syncing_since", { when: relTime(startedAt, now) })} ` : "", p("syncing_note")]
					})
				]
			}),
			/* @__PURE__ */ u("p", {
				class: "error",
				"aria-live": "assertive",
				"data-testid": "sync-error",
				children: error ?? ""
			}),
			/* @__PURE__ */ u(SyncButton, {
				running,
				onClick: onSyncNow
			})
		]
	});
}
function SyncButton({ running, onClick, quiet }) {
	return /* @__PURE__ */ u("button", {
		type: "button",
		class: `btn ${quiet ? "btn-secondary" : "btn-primary"} btn-block`,
		"data-testid": "sync-now",
		disabled: running,
		"aria-busy": running ? "true" : void 0,
		onClick,
		children: [running && /* @__PURE__ */ u("span", {
			class: "spinner",
			"aria-hidden": "true"
		}), p("sync_now")]
	});
}
/**
* Queue card: shows, stops, resumes and — for items already queued in Hermes — asks for the click that lets a
* round run ("Run now"). No choosing or approving items here.
*/
function QueueCard({ view, busy, error, onStop, onResume, onOpenYouTube, onRunNow, onNotNow }) {
	const moving = view.state === "running" || view.state === "stopping" || view.state === "resuming";
	const askYouTube = view.state === "held" && (view.holdReason === "logged_out" || view.holdReason === "challenge");
	return /* @__PURE__ */ u("section", {
		class: `card queue queue-${view.state}`,
		"data-testid": "queue-card",
		"data-state": view.state,
		"aria-labelledby": "queue-title",
		children: [
			/* @__PURE__ */ u("h2", {
				id: "queue-title",
				class: "label",
				children: p("queue_label")
			}),
			view.heading && /* @__PURE__ */ u("p", {
				class: "head",
				children: view.heading
			}),
			/* @__PURE__ */ u("p", {
				class: "body",
				"data-testid": "queue-line",
				"aria-live": "polite",
				"aria-atomic": "true",
				children: view.line
			}),
			moving && /* @__PURE__ */ u("div", {
				class: "bar",
				"aria-hidden": "true",
				children: /* @__PURE__ */ u("span", {})
			}),
			view.channels && view.channels.length > 0 && /* @__PURE__ */ u("ul", {
				class: "waiting",
				"data-testid": "queue-waiting-list",
				children: view.channels.map((c, i) => /* @__PURE__ */ u("li", { children: c }, `${i}:${c}`))
			}),
			view.failures.length > 0 && /* @__PURE__ */ u("ul", {
				class: "fails",
				"data-testid": "queue-failures",
				children: view.failures.map((f) => /* @__PURE__ */ u("li", { children: f }, f))
			}),
			view.notes.map((n) => /* @__PURE__ */ u("p", {
				class: "meta",
				children: n
			}, n)),
			/* @__PURE__ */ u("p", {
				class: "error",
				"aria-live": "assertive",
				"data-testid": "queue-error",
				children: error ?? ""
			}),
			view.state === "waiting" && /* @__PURE__ */ u("div", {
				class: "actions",
				children: [/* @__PURE__ */ u("button", {
					type: "button",
					class: "btn btn-primary",
					"data-testid": "queue-run-now",
					disabled: busy,
					onClick: onRunNow,
					children: p("queue_run_now")
				}), /* @__PURE__ */ u("button", {
					type: "button",
					class: "btn btn-secondary",
					"data-testid": "queue-not-now",
					disabled: busy,
					onClick: onNotNow,
					children: p("queue_not_now")
				})]
			}),
			view.state === "running" && /* @__PURE__ */ u("div", {
				class: "actions",
				children: /* @__PURE__ */ u("button", {
					type: "button",
					class: "btn btn-secondary",
					"data-testid": "queue-stop",
					disabled: busy,
					onClick: onStop,
					children: p("queue_stop")
				})
			}),
			view.state === "stopped" && /* @__PURE__ */ u("div", {
				class: "actions",
				children: /* @__PURE__ */ u("button", {
					type: "button",
					class: "btn btn-primary",
					"data-testid": "queue-resume",
					disabled: busy,
					onClick: onResume,
					children: p("queue_resume")
				})
			}),
			view.state === "held" && /* @__PURE__ */ u("div", {
				class: "actions",
				children: [/* @__PURE__ */ u("button", {
					type: "button",
					class: "btn btn-primary",
					"data-testid": "queue-retry",
					disabled: busy,
					onClick: onResume,
					children: p(view.holdReason === "cap" ? "queue_continue_now" : "queue_retry")
				}), askYouTube && /* @__PURE__ */ u("button", {
					type: "button",
					class: "btn btn-secondary",
					"data-testid": "queue-open-youtube",
					onClick: onOpenYouTube,
					children: p("open_youtube")
				})]
			})
		]
	});
}
function Problem({ kind, body, children }) {
	const icon = kind === "closed" ? Icons.plug() : kind === "unauthorized" ? Icons.key() : kind === "logged_out" ? Icons.user() : Icons.alert();
	return /* @__PURE__ */ u("section", {
		class: "card problem",
		"data-testid": "problem",
		role: "alert",
		"aria-labelledby": "problem-title",
		children: [
			/* @__PURE__ */ u("div", {
				class: "problem-head",
				children: [/* @__PURE__ */ u("span", {
					class: `problem-icon problem-${kind}`,
					children: icon
				}), /* @__PURE__ */ u("h2", {
					id: "problem-title",
					class: "head",
					children: p(`problem_${kind}_title`)
				})]
			}),
			/* @__PURE__ */ u("p", {
				class: "body",
				children: body ?? p(`problem_${kind}_body`)
			}),
			/* @__PURE__ */ u("div", {
				class: "actions",
				children
			})
		]
	});
}
function Footer({ onOpenHermes, onDisconnect }) {
	const [confirming, setConfirming] = d(false);
	const [busy, setBusy] = d(false);
	const opener = A(null);
	const safe = A(null);
	const wasConfirming = A(false);
	h(() => {
		if (confirming) safe.current?.focus();
		else if (wasConfirming.current) opener.current?.focus();
		wasConfirming.current = confirming;
	}, [confirming]);
	return /* @__PURE__ */ u(S, { children: [/* @__PURE__ */ u("footer", {
		class: "foot",
		children: [/* @__PURE__ */ u("button", {
			type: "button",
			class: "link",
			"data-testid": "open-hermes",
			onClick: onOpenHermes,
			children: [p("open_hermes"), Icons.external()]
		}), /* @__PURE__ */ u("button", {
			ref: opener,
			type: "button",
			class: "link link-quiet",
			"data-testid": "disconnect",
			"aria-expanded": confirming ? "true" : "false",
			"aria-controls": "disconnect-confirm",
			onClick: () => setConfirming(true),
			children: p("disconnect")
		})]
	}), confirming && /* @__PURE__ */ u("div", {
		id: "disconnect-confirm",
		class: "card confirm",
		"data-testid": "disconnect-confirm",
		role: "alertdialog",
		"aria-labelledby": "dc-title",
		"aria-describedby": "dc-body",
		onKeyDown: (e) => {
			if (e.key === "Escape" && !busy) {
				e.preventDefault();
				setConfirming(false);
			}
		},
		children: [
			/* @__PURE__ */ u("p", {
				id: "dc-title",
				class: "head",
				children: p("disconnect_title")
			}),
			/* @__PURE__ */ u("p", {
				id: "dc-body",
				class: "body",
				children: p("disconnect_body")
			}),
			/* @__PURE__ */ u("div", {
				class: "actions",
				children: [/* @__PURE__ */ u("button", {
					ref: safe,
					type: "button",
					class: "btn btn-secondary",
					"data-testid": "disconnect-cancel",
					disabled: busy,
					onClick: () => setConfirming(false),
					children: p("cancel")
				}), /* @__PURE__ */ u("button", {
					type: "button",
					class: "btn btn-danger",
					"data-testid": "disconnect-yes",
					disabled: busy,
					onClick: async () => {
						setBusy(true);
						await onDisconnect();
					},
					children: busy ? p("disconnecting") : p("disconnect_yes")
				})]
			})
		]
	})] });
}
// extension/src/popup/App.tsx
/** Plugin page in Hermes Desktop (`hermes://open/<route>` → app route). */
var HERMES_URL = `hermes://open${DESKTOP_ROUTES.home}`;
var YOUTUBE_URL = "https://www.youtube.com/";
/** Resume requested and no round started (nothing pending on the server): goes back to the summary after this. */
var RESUMING_MS = 2e4;
var UNPAIRED = {
	state: "unpaired",
	port: null,
	device_id: null,
	last_ok_at: null,
	error: null
};
function pendingOf(cache) {
	const count = cache?.state?.queue_pending;
	return typeof count === "number" && typeof cache?.fetched_at === "number" ? {
		count,
		at: cache.fetched_at
	} : null;
}
function App({ now = Date.now }) {
	const [conn, setConn] = d(null);
	const [checking, setChecking] = d(false);
	const [sync, setSync] = d(null);
	const [info, setInfo] = d(null);
	const [portOverride, setPortOverride] = d(null);
	const [syncRequested, setSyncRequested] = d(null);
	const [syncError, setSyncError] = d(null);
	const [queueRun, setQueueRun] = d(null);
	const [queueCtl, setQueueCtl] = d(null);
	const [ledger, setLedger] = d(null);
	const [pending, setPending] = d(null);
	const [stopRequested, setStopRequested] = d(false);
	const [resuming, setResuming] = d(false);
	const [queueBusy, setQueueBusy] = d(false);
	const [queueError, setQueueError] = d(null);
	const [waiting, setWaiting] = d(null);
	const [release, setRelease] = d(null);
	const [snoozed, setSnoozed] = d([]);
	const [, setTick] = d(0);
	const refreshConn = q(async (probe = false) => {
		if (probe) setChecking(true);
		const res = await sendRequest("conn.status", probe ? { probe: true } : {});
		if (probe) setChecking(false);
		if (res.ok) setConn(res.data);
		else setConn((c) => c ?? UNPAIRED);
	}, []);
	h(() => {
		let alive = true;
		(async () => {
			const got = await chrome.storage.local.get([
				STORAGE_KEYS.syncStatus,
				STORAGE_KEYS.stateCache,
				PAIR_INFO_KEY,
				PAIR_PORT_KEY,
				STORAGE_KEYS.queueRun,
				STORAGE_KEYS.queueCtl,
				STORAGE_KEYS.queueLedger
			]);
			if (!alive) return;
			const cache = got[STORAGE_KEYS.stateCache];
			const lang = cache?.state?.language;
			if (lang) setLanguage(lang);
			document.documentElement.lang = getLanguage();
			setSync(got[STORAGE_KEYS.syncStatus] ?? null);
			setInfo(got[PAIR_INFO_KEY] ?? null);
			const port = got[PAIR_PORT_KEY];
			setPortOverride(typeof port === "number" ? port : null);
			setQueueRun(got[STORAGE_KEYS.queueRun] ?? null);
			setQueueCtl(got[STORAGE_KEYS.queueCtl] ?? null);
			setLedger(got[STORAGE_KEYS.queueLedger] ?? null);
			setPending(pendingOf(cache));
			await readSessionQueue();
			await refreshConn(false);
			if (alive) await refreshConn(true);
		})();
		async function readSessionQueue() {
			const [wt, rl, sn] = await Promise.all([
				readWaiting(),
				readRelease(),
				readSnooze()
			]);
			if (!alive) return;
			setWaiting(wt);
			setRelease(rl);
			setSnoozed(sn);
		}
		const onChanged = (changes, area) => {
			if (area === "session") {
				if ("queue_waiting" in changes || "queue_release" in changes || "queue_snooze" in changes) readSessionQueue();
				return;
			}
			if (area !== "local") return;
			if (STORAGE_KEYS.syncStatus in changes) {
				const next = changes[STORAGE_KEYS.syncStatus].newValue ?? null;
				setSync(next);
				if (!next || next.state !== "running") setSyncRequested(null);
			}
			if (PAIR_INFO_KEY in changes) setInfo(changes[PAIR_INFO_KEY].newValue ?? null);
			if (STORAGE_KEYS.queueRun in changes) {
				const next = changes[STORAGE_KEYS.queueRun].newValue ?? null;
				setQueueRun(next);
				if (!next || next.state !== "running") setStopRequested(false);
				if (!next || next.state !== "idle") setResuming(false);
			}
			if (STORAGE_KEYS.queueCtl in changes) setQueueCtl(changes[STORAGE_KEYS.queueCtl].newValue ?? null);
			if (STORAGE_KEYS.queueLedger in changes) setLedger(changes[STORAGE_KEYS.queueLedger].newValue ?? null);
			if (STORAGE_KEYS.stateCache in changes) setPending(pendingOf(changes[STORAGE_KEYS.stateCache].newValue));
			if (STORAGE_KEYS.connection in changes) refreshConn(false);
		};
		chrome.storage.onChanged.addListener(onChanged);
		return () => {
			alive = false;
			chrome.storage.onChanged.removeListener(onChanged);
		};
	}, [refreshConn]);
	const t0 = now();
	const running = syncRequested !== null || isRunning(sync, t0);
	const queue = queueView({
		run: queueRun,
		ctl: queueCtl,
		ledger,
		pending,
		now: t0,
		stopRequested,
		resuming,
		waiting: unreleased(waiting, release, snoozed)
	});
	const queueMoving = queue?.state === "running" || queue?.state === "stopping" || queue?.state === "resuming";
	h(() => {
		const id = setInterval(() => setTick((n) => n + 1), running || queueMoving ? 1e3 : 15e3);
		return () => clearInterval(id);
	}, [running, queueMoving]);
	h(() => {
		if (!resuming) return;
		const id = setTimeout(() => setResuming(false), RESUMING_MS);
		return () => clearTimeout(id);
	}, [resuming]);
	async function submitCode(code, port) {
		const res = await sendRequest("pair.submit", port === null ? { code } : {
			code,
			port
		});
		setPortOverride(port);
		if (!res.ok) return res.error;
		setConn(res.data);
		return null;
	}
	async function syncNow() {
		setSyncError(null);
		setSyncRequested(now());
		const res = await sendRequest("sync.now", {});
		if (!res.ok) {
			setSyncRequested(null);
			setSyncError(syncErrorText(res.error.code));
			if (res.error.code === "unauthorized") refreshConn(false);
			return;
		}
		if (!res.data.started) {
			setSyncRequested(null);
			setSyncError(syncErrorText("not_started"));
		}
	}
	/** Stop: only asks the background (which records the stop); the item in progress finishes. */
	async function onQueueStop() {
		setQueueError(null);
		setQueueBusy(true);
		setStopRequested(true);
		const res = await sendRequest("queue.stop", {});
		setQueueBusy(false);
		if (!res.ok) {
			setStopRequested(false);
			setQueueError(p("queue_err"));
		}
	}
	/** Resume / Try again: the background releases the queue; what runs still comes from the server. */
	async function onQueueResume() {
		setQueueError(null);
		setQueueBusy(true);
		setResuming(true);
		const res = await sendRequest("queue.resume", {});
		setQueueBusy(false);
		if (!res.ok) {
			setResuming(false);
			setQueueError(p("queue_err"));
		}
	}
	/**
	* Run now: releases exactly the ids the card lists (session storage), then asks the background for a fresh state —
	* the round still takes its items from the server, one by one, and only these ids.
	*/
	async function onQueueRunNow(ids) {
		if (!ids.length) return;
		setQueueError(null);
		setQueueBusy(true);
		setResuming(true);
		try {
			await releaseQueue(ids);
			const res = await sendRequest("queue.resume", {});
			if (!res.ok) throw new Error(res.error.code);
		} catch {
			setResuming(false);
			setQueueError(p("queue_err"));
		} finally {
			setQueueBusy(false);
		}
	}
	/** Not now: these items stay in the Hermes queue and wait; the badge goes away until something new arrives. */
	async function onQueueNotNow(ids) {
		setQueueError(null);
		await snoozeQueue(ids);
		setSnoozed((s) => [.../* @__PURE__ */ new Set([...s, ...ids])]);
	}
	async function unpair() {
		const res = await sendRequest("pair.unpair", {});
		setSync(null);
		setInfo(null);
		setPortOverride(null);
		setSyncRequested(null);
		setSyncError(null);
		setQueueRun(null);
		setQueueCtl(null);
		setLedger(null);
		setStopRequested(false);
		setResuming(false);
		setConn(res.ok ? res.data : UNPAIRED);
	}
	const open = (url) => void chrome.tabs.create({ url });
	const state = conn?.state ?? null;
	const pill = !conn ? "loading" : checking && state !== "connected" && state !== "unpaired" ? "checking" : conn.state;
	const queueCard = queue ? /* @__PURE__ */ u(QueueCard, {
		view: queue,
		busy: queueBusy,
		error: queueError,
		onStop: () => void onQueueStop(),
		onResume: () => void onQueueResume(),
		onOpenYouTube: () => open(YOUTUBE_URL),
		onRunNow: () => void onQueueRunNow(queue.ids ?? []),
		onNotNow: () => void onQueueNotNow(queue.ids ?? [])
	}) : null;
	let body;
	if (!conn) body = /* @__PURE__ */ u("div", {
		class: "pane skeleton",
		"aria-busy": "true",
		children: [
			/* @__PURE__ */ u("p", {
				class: "sr-only",
				children: p("loading")
			}),
			/* @__PURE__ */ u("span", { class: "sk sk-line" }),
			/* @__PURE__ */ u("span", { class: "sk sk-line sk-short" }),
			/* @__PURE__ */ u("span", { class: "sk sk-block" })
		]
	});
	else if (conn.state === "unpaired") body = /* @__PURE__ */ u(Unpaired, {
		initialAddress: portOverride ? `http://127.0.0.1:${portOverride}` : "",
		onSubmit: submitCode
	});
	else {
		const device = /* @__PURE__ */ u(Device, {
			name: info?.device_name ?? deviceName(),
			pairedAt: info?.paired_at ?? null,
			lastOkAt: conn.last_ok_at,
			connected: conn.state === "connected",
			port: conn.port,
			deviceId: conn.device_id,
			now: t0
		});
		const footer = /* @__PURE__ */ u(Footer, {
			onOpenHermes: () => open(HERMES_URL),
			onDisconnect: unpair
		});
		const retry = /* @__PURE__ */ u("button", {
			type: "button",
			class: "btn btn-primary",
			"data-testid": "problem-retry",
			disabled: checking,
			onClick: () => void refreshConn(true),
			children: checking ? p("checking") : p("retry")
		});
		if (conn.state === "unauthorized") body = /* @__PURE__ */ u("div", {
			class: "pane",
			children: [/* @__PURE__ */ u(Problem, {
				kind: "unauthorized",
				children: /* @__PURE__ */ u("button", {
					type: "button",
					class: "btn btn-primary",
					"data-testid": "pair-again",
					onClick: () => void unpair(),
					children: p("pair_again")
				})
			}), queueCard]
		});
		else if (conn.state === "reconnect_needed") body = /* @__PURE__ */ u("div", {
			class: "pane",
			children: [
				/* @__PURE__ */ u(Problem, {
					kind: "closed",
					children: [retry, /* @__PURE__ */ u("button", {
						type: "button",
						class: "btn btn-secondary",
						"data-testid": "open-hermes-problem",
						onClick: () => open(HERMES_URL),
						children: p("open_hermes")
					})]
				}),
				queueCard,
				device,
				footer
			]
		});
		else if (conn.state === "error") body = /* @__PURE__ */ u("div", {
			class: "pane",
			children: [
				/* @__PURE__ */ u(Problem, {
					kind: "error",
					body: connErrorText(conn.error),
					children: retry
				}),
				queueCard,
				device,
				footer
			]
		});
		else if (isLoggedOut(sync) && !running) body = /* @__PURE__ */ u("div", {
			class: "pane",
			children: [
				/* @__PURE__ */ u(Problem, {
					kind: "logged_out",
					children: [/* @__PURE__ */ u("button", {
						type: "button",
						class: "btn btn-primary",
						"data-testid": "open-youtube",
						onClick: () => open(YOUTUBE_URL),
						children: p("open_youtube")
					}), /* @__PURE__ */ u(SyncButton, {
						running,
						onClick: () => void syncNow(),
						quiet: true
					})]
				}),
				queueCard,
				device,
				footer
			]
		});
		else body = /* @__PURE__ */ u("div", {
			class: "pane",
			children: [
				queueCard,
				device,
				/* @__PURE__ */ u(SyncCard, {
					sync,
					running,
					startedAt: isRunning(sync, t0) ? sync?.started_at ?? null : null,
					error: syncError,
					now: t0,
					onSyncNow: () => void syncNow()
				}),
				footer
			]
		});
	}
	return /* @__PURE__ */ u("main", {
		class: "popup",
		"data-testid": "conn-state",
		"data-state": state ?? "",
		"aria-busy": conn ? void 0 : "true",
		children: [/* @__PURE__ */ u(Header, { pill }), body]
	});
}
/** `error` connection state (transport error stored by the client): text by code. */
function connErrorText(err) {
	const code = err?.code;
	if (code === "plugin_disabled") return p("err_plugin_disabled");
	if (code === "timeout") return p("err_timeout");
	if (code && [
		"origin_forbidden",
		"origin_mismatch",
		"host_forbidden"
	].includes(code)) return p("err_refused");
	return p("problem_error_body");
}
// extension/src/popup/main.tsx
if (isWelcomeSurface(location.search)) document.documentElement.dataset.surface = "tab";
var root = document.getElementById("app");
if (root) R(/* @__PURE__ */ u(App, {}), root);
