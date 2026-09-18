var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../node_modules/hono/dist/compose.js
var compose = /* @__PURE__ */ __name((middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || void 0;
      }
      if (handler) {
        try {
          res = await handler(context, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context.error = err;
            res = await onError(err, context);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context.finalized === false && onNotFound) {
          res = await onNotFound(context);
        }
      }
      if (res && (context.finalized === false || isError)) {
        context.res = res;
      }
      return context;
    }
    __name(dispatch, "dispatch");
  };
}, "compose");

// ../node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// ../node_modules/hono/dist/utils/buffer.js
var bufferToFormData = /* @__PURE__ */ __name((arrayBuffer, contentType) => {
  const response = new Response(arrayBuffer, {
    headers: {
      // Normalize the media type (case-insensitive) while keeping parameters like the boundary
      "Content-Type": contentType.replace(/^[^;]+/, (mediaType) => mediaType.toLowerCase())
    }
  });
  return response.formData();
}, "bufferToFormData");

// ../node_modules/hono/dist/utils/body.js
var MAX_NESTING_DEPTH = 32;
var MAX_NESTED_OBJECTS = 1e4;
var isRawRequest = /* @__PURE__ */ __name((request) => "headers" in request, "isRawRequest");
var parseBody = /* @__PURE__ */ __name(async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const contentType = headers.get("Content-Type");
  const mediaType = contentType?.split(";")[0].trim().toLowerCase();
  if (mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded") {
    return parseFormData(request, { all, dot });
  }
  return {};
}, "parseBody");
async function parseFormData(request, options) {
  if (!isRawRequest(request) && request.bodyCache.formData) {
    return convertFormDataToBodyData(
      await request.bodyCache.formData,
      options
    );
  }
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const arrayBuffer = await request.arrayBuffer();
  const formDataPromise = bufferToFormData(arrayBuffer, headers.get("Content-Type") || "");
  if (!isRawRequest(request)) {
    request.bodyCache.formData = formDataPromise;
  }
  const formData = await formDataPromise;
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
__name(parseFormData, "parseFormData");
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  const nestingState = { count: 0 };
  formData.forEach((value, key2) => {
    const shouldParseAllValues = options.all || key2.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key2] = value;
    } else {
      handleParsingAllValues(form, key2, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key2, value]) => {
      const shouldParseDotValues = key2.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key2, value, nestingState);
        delete form[key2];
      }
    });
  }
  return form;
}
__name(convertFormDataToBodyData, "convertFormDataToBodyData");
var handleParsingAllValues = /* @__PURE__ */ __name((form, key2, value) => {
  if (form[key2] !== void 0) {
    if (Array.isArray(form[key2])) {
      ;
      form[key2].push(value);
    } else {
      form[key2] = [form[key2], value];
    }
  } else {
    if (!key2.endsWith("[]")) {
      form[key2] = value;
    } else {
      form[key2] = [value];
    }
  }
}, "handleParsingAllValues");
var handleParsingNestedValues = /* @__PURE__ */ __name((form, key2, value, state) => {
  if (/(?:^|\.)__proto__\./.test(key2)) {
    return;
  }
  let nestedForm = form;
  const keys = key2.split(".", MAX_NESTING_DEPTH + 2);
  if (keys.length > MAX_NESTING_DEPTH + 1) {
    throwNestingLimitExceeded();
  }
  keys.forEach((key22, index) => {
    if (index === keys.length - 1) {
      nestedForm[key22] = value;
    } else {
      if (!nestedForm[key22] || typeof nestedForm[key22] !== "object" || Array.isArray(nestedForm[key22]) || nestedForm[key22] instanceof File) {
        if (state.count++ >= MAX_NESTED_OBJECTS) {
          throwNestingLimitExceeded();
        }
        nestedForm[key22] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key22];
    }
  });
}, "handleParsingNestedValues");
var throwNestingLimitExceeded = /* @__PURE__ */ __name(() => {
  throw new Error("Nesting limit exceeded");
}, "throwNestingLimitExceeded");

// ../node_modules/hono/dist/utils/url.js
var splitPath = /* @__PURE__ */ __name((path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
}, "splitPath");
var splitRoutingPath = /* @__PURE__ */ __name((routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
}, "splitRoutingPath");
var extractGroupsFromPath = /* @__PURE__ */ __name((path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return { groups, path };
}, "extractGroupsFromPath");
var replaceGroupMarks = /* @__PURE__ */ __name((paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
}, "replaceGroupMarks");
var patternCache = {};
var getPattern = /* @__PURE__ */ __name((label, next) => {
  if (label === "*") {
    return "*";
  }
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match2[1], new RegExp(`^${match2[2]}(?=/${next})`)] : [label, match2[1], new RegExp(`^${match2[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match2[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
}, "getPattern");
var tryDecode = /* @__PURE__ */ __name((str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
}, "tryDecode");
var tryDecodeURI = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURI), "tryDecodeURI");
var getPath = /* @__PURE__ */ __name((request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) {
      break;
    }
  }
  return url.slice(start, i);
}, "getPath");
var getPathNoStrict = /* @__PURE__ */ __name((request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
}, "getPathNoStrict");
var mergePath = /* @__PURE__ */ __name((base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
}, "mergePath");
var checkOptionalParameter = /* @__PURE__ */ __name((path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (segment.charCodeAt(segment.length - 1) === 63) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.slice(0, -1);
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
}, "checkOptionalParameter");
var tryDecodeURIComponent = /* @__PURE__ */ __name((str) => str.indexOf("%") !== -1 ? tryDecode(str, decodeURIComponent_) : str, "tryDecodeURIComponent");
var _decodeURI = /* @__PURE__ */ __name((value) => {
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return tryDecodeURIComponent(value);
}, "_decodeURI");
var _getQueryParam = /* @__PURE__ */ __name((url, key2, multiple) => {
  const hashIndex = url.indexOf("#", 8);
  if (hashIndex !== -1) {
    url = url.slice(0, hashIndex);
  }
  let encoded;
  if (!multiple && key2 && key2.indexOf("%") === -1 && key2.indexOf("+") === -1) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return void 0;
    }
    if (!url.startsWith(key2, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key2}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key2.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key2.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key2}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = /* @__PURE__ */ Object.create(null);
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key2 ? results[key2] : results;
}, "_getQueryParam");
var getQueryParam = _getQueryParam;
var getQueryParams = /* @__PURE__ */ __name((url, key2) => {
  return _getQueryParam(url, key2, true);
}, "getQueryParams");
var decodeURIComponent_ = decodeURIComponent;

// ../node_modules/hono/dist/request.js
var HonoRequest = class {
  static {
    __name(this, "HonoRequest");
  }
  /**
   * `.raw` can get the raw Request object.
   *
   * @see {@link https://hono.dev/docs/api/request#raw}
   *
   * @example
   * ```ts
   * // For Cloudflare Workers
   * app.post('/', async (c) => {
   *   const metadata = c.req.raw.cf?.hostMetadata?
   *   ...
   * })
   * ```
   */
  raw;
  #validatedData;
  // Short name of validatedData
  #matchResult;
  routeIndex = 0;
  /**
   * `.path` can get the pathname of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#path}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const pathname = c.req.path // `/about/me`
   * })
   * ```
   */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
  }
  param(key2) {
    return key2 ? this.#getDecodedParam(key2) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key2) {
    const paramKey = this.#matchResult[0][this.routeIndex]?.[1][key2];
    const param = this.#getParamValue(paramKey);
    return param && tryDecodeURIComponent(param);
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex]?.[1] ?? {});
    for (const key2 of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key2]);
      if (value !== void 0) {
        decoded[key2] = tryDecodeURIComponent(value);
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key2) {
    return getQueryParam(this.url, key2);
  }
  queries(key2) {
    return getQueryParams(this.url, key2);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = /* @__PURE__ */ Object.create(null);
    this.raw.headers.forEach((value, key2) => {
      headerData[key2] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = /* @__PURE__ */ __name((key2) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key2];
    if (cachedBody) {
      return cachedBody;
    }
    for (const anyCachedKey in bodyCache) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key2]();
      });
    }
    return bodyCache[key2] = raw2[key2]();
  }, "#cachedBody");
  /**
   * `.json()` can parse Request body of type `application/json`
   *
   * @see {@link https://hono.dev/docs/api/request#json}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.json()
   * })
   * ```
   */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
   * `.text()` can parse Request body of type `text/plain`
   *
   * @see {@link https://hono.dev/docs/api/request#text}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.text()
   * })
   * ```
   */
  text() {
    return this.#cachedBody("text");
  }
  /**
   * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
   *
   * @see {@link https://hono.dev/docs/api/request#arraybuffer}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.arrayBuffer()
   * })
   * ```
   */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
   * `.bytes()` parses the request body as a `Uint8Array`.
   *
   * @see {@link https://hono.dev/docs/api/request#bytes}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.bytes()
   * })
   * ```
   */
  bytes() {
    return this.#cachedBody("arrayBuffer").then((buffer) => new Uint8Array(buffer));
  }
  /**
   * Parses the request body as a `Blob`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.blob();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#blob
   */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
   * Parses the request body as `FormData`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.formData();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#formdata
   */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
   * Adds validated data to the request.
   *
   * @param target - The target of the validation.
   * @param data - The validated data to add.
   */
  addValidatedData(target, data) {
    ;
    (this.#validatedData ??= {})[target] = data;
  }
  valid(target) {
    return this.#validatedData?.[target];
  }
  /**
   * `.url()` can get the request url strings.
   *
   * @see {@link https://hono.dev/docs/api/request#url}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const url = c.req.url // `http://localhost:8787/about/me`
   *   ...
   * })
   * ```
   */
  get url() {
    return this.raw.url;
  }
  /**
   * `.method()` can get the method name of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#method}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const method = c.req.method // `GET`
   * })
   * ```
   */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
   * `.matchedRoutes()` can return a matched route in the handler
   *
   * @deprecated
   *
   * Use matchedRoutes helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#matchedroutes}
   *
   * @example
   * ```ts
   * app.use('*', async function logger(c, next) {
   *   await next()
   *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
   *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
   *     console.log(
   *       method,
   *       ' ',
   *       path,
   *       ' '.repeat(Math.max(10 - path.length, 0)),
   *       name,
   *       i === c.req.routeIndex ? '<- respond from here' : ''
   *     )
   *   })
   * })
   * ```
   */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
   * `routePath()` can retrieve the path registered within the handler
   *
   * @deprecated
   *
   * Use routePath helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#routepath}
   *
   * @example
   * ```ts
   * app.get('/posts/:id', (c) => {
   *   return c.json({ path: c.req.routePath })
   * })
   * ```
   */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// ../node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = /* @__PURE__ */ __name((value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
}, "raw");
var resolveCallback = /* @__PURE__ */ __name(async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
}, "resolveCallback");

// ../node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = /* @__PURE__ */ __name((contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, "setDefaultContentType");
var createResponseInstance = /* @__PURE__ */ __name((body, init) => new Response(body, init), "createResponseInstance");
var Context = class {
  static {
    __name(this, "Context");
  }
  #rawRequest;
  #req;
  /**
   * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
   *
   * @see {@link https://hono.dev/docs/api/context#env}
   *
   * @example
   * ```ts
   * // Environment object for Cloudflare Workers
   * app.get('*', async c => {
   *   const counter = c.env.COUNTER
   * })
   * ```
   */
  env = {};
  #var;
  finalized = false;
  /**
   * `.error` can get the error object from the middleware if the Handler throws an error.
   *
   * @see {@link https://hono.dev/docs/api/context#error}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   await next()
   *   if (c.error) {
   *     // do something...
   *   }
   * })
   * ```
   */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
   * Creates an instance of the Context class.
   *
   * @param req - The Request object.
   * @param options - Optional configuration options for the context.
   */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
   * `.req` is the instance of {@link HonoRequest}.
   */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#event}
   * The FetchEvent associated with the current request.
   *
   * @throws Will throw an error if the context does not have a FetchEvent.
   */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#executionctx}
   * The ExecutionContext associated with the current request.
   *
   * @throws Will throw an error if the context does not have an ExecutionContext.
   */
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#res}
   * The Response object for the current request.
   */
  get res() {
    return this.#res ||= createResponseInstance(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  /**
   * Sets the Response object for the current request.
   *
   * @param _res - The Response object to set.
   */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
   * `.render()` can create a response within a layout.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   return c.render('Hello!')
   * })
   * ```
   */
  render = /* @__PURE__ */ __name((...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  }, "render");
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = /* @__PURE__ */ __name((layout) => this.#layout = layout, "setLayout");
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = /* @__PURE__ */ __name(() => this.#layout, "getLayout");
  /**
   * `.setRenderer()` can set the layout in the custom middleware.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```tsx
   * app.use('*', async (c, next) => {
   *   c.setRenderer((content) => {
   *     return c.html(
   *       <html>
   *         <body>
   *           <p>{content}</p>
   *         </body>
   *       </html>
   *     )
   *   })
   *   await next()
   * })
   * ```
   */
  setRenderer = /* @__PURE__ */ __name((renderer) => {
    this.#renderer = renderer;
  }, "setRenderer");
  /**
   * `.header()` can set headers.
   *
   * @see {@link https://hono.dev/docs/api/context#header}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *
   *   // Append multiple headers using the append option (e.g. Vary)
   *   c.header('Vary', 'Accept-Encoding', { append: true })
   *   c.header('Vary', 'User-Agent', { append: true })
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = /* @__PURE__ */ __name((name, value, options) => {
    if (this.finalized) {
      this.#res = createResponseInstance(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  }, "header");
  status = /* @__PURE__ */ __name((status) => {
    this.#status = status;
  }, "status");
  /**
   * `.set()` can set the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   c.set('message', 'Hono is hot!!')
   *   await next()
   * })
   * ```
   */
  set = /* @__PURE__ */ __name((key2, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key2, value);
  }, "set");
  /**
   * `.get()` can use the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   const message = c.get('message')
   *   return c.text(`The message is "${message}"`)
   * })
   * ```
   */
  get = /* @__PURE__ */ __name((key2) => {
    return this.#var ? this.#var.get(key2) : void 0;
  }, "get");
  /**
   * `.var` can access the value of a variable.
   *
   * @see {@link https://hono.dev/docs/api/context#var}
   *
   * @example
   * ```ts
   * const result = c.var.client.oneMethod()
   * ```
   */
  // c.var.propName is a read-only
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    let responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders;
    if (typeof arg === "object" && arg.headers) {
      responseHeaders ??= new Headers();
      for (const [key2, value] of new Headers(arg.headers)) {
        if (key2 === "set-cookie") {
          responseHeaders.append(key2, value);
        } else {
          responseHeaders.set(key2, value);
        }
      }
    }
    if (headers) {
      if (!responseHeaders) {
        let count = 0;
        for (const k in headers) {
          if (++count > 1 || typeof headers[k] !== "string") {
            responseHeaders = new Headers();
            break;
          }
        }
      }
      if (responseHeaders) {
        for (const k in headers) {
          const v = headers[k];
          if (typeof v === "string") {
            responseHeaders.set(k, v);
          } else {
            responseHeaders.delete(k);
            for (const v2 of v) {
              responseHeaders.append(k, v2);
            }
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, {
      status,
      headers: responseHeaders ?? headers
    });
  }
  newResponse = /* @__PURE__ */ __name((...args) => this.#newResponse(...args), "newResponse");
  /**
   * `.body()` can return the HTTP response.
   * You can set headers with `.header()` and set HTTP status code with `.status`.
   * This can also be set in `.text()`, `.json()` and so on.
   *
   * @see {@link https://hono.dev/docs/api/context#body}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *   // Set HTTP status code
   *   c.status(201)
   *
   *   // Return the response body
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  body = /* @__PURE__ */ __name((data, arg, headers) => this.#newResponse(data, arg, headers), "body");
  /**
   * `.text()` can render text as `Content-Type:text/plain`.
   *
   * @see {@link https://hono.dev/docs/api/context#text}
   *
   * @example
   * ```ts
   * app.get('/say', (c) => {
   *   return c.text('Hello!')
   * })
   * ```
   */
  text = /* @__PURE__ */ __name((text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  }, "text");
  /**
   * `.json()` can render JSON as `Content-Type:application/json`.
   *
   * @see {@link https://hono.dev/docs/api/context#json}
   *
   * @example
   * ```ts
   * app.get('/api', (c) => {
   *   return c.json({ message: 'Hello!' })
   * })
   * ```
   */
  json = /* @__PURE__ */ __name((object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  }, "json");
  html = /* @__PURE__ */ __name((html, arg, headers) => {
    const res = /* @__PURE__ */ __name((html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers)), "res");
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  }, "html");
  /**
   * `.redirect()` can Redirect, default status code is 302.
   *
   * @see {@link https://hono.dev/docs/api/context#redirect}
   *
   * @example
   * ```ts
   * app.get('/redirect', (c) => {
   *   return c.redirect('/')
   * })
   * app.get('/redirect-permanently', (c) => {
   *   return c.redirect('/', 301)
   * })
   * ```
   */
  redirect = /* @__PURE__ */ __name((location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibyes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  }, "redirect");
  /**
   * `.notFound()` can return the Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/context#notfound}
   *
   * @example
   * ```ts
   * app.get('/notfound', (c) => {
   *   return c.notFound()
   * })
   * ```
   */
  notFound = /* @__PURE__ */ __name(() => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  }, "notFound");
};

// ../node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch", "query"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
  static {
    __name(this, "UnsupportedPathError");
  }
};

// ../node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// ../node_modules/hono/dist/hono-base.js
var notFoundHandler = /* @__PURE__ */ __name((c) => {
  return c.text("404 Not Found", 404);
}, "notFoundHandler");
var errorHandler = /* @__PURE__ */ __name((err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
}, "errorHandler");
var Hono = class _Hono {
  static {
    __name(this, "_Hono");
  }
  get;
  post;
  put;
  delete;
  options;
  patch;
  query;
  all;
  on;
  use;
  /*
    This class is like an abstract class and does not have a router.
    To use it, inherit the class and implement router in the constructor.
  */
  router;
  getPath;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        const methodName = method.toUpperCase();
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(methodName, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(methodName, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          const methodName = m.toUpperCase();
          for (const handler of handlers) {
            this.#addRoute(methodName, this.#path, handler);
          }
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  errorHandler = errorHandler;
  /**
   * `.route()` allows grouping other Hono instance in routes.
   *
   * @see {@link https://hono.dev/docs/api/routing#grouping}
   *
   * @param {string} path - base Path
   * @param {Hono} app - other Hono instance
   * @returns {Hono} routed Hono instance
   *
   * @example
   * ```ts
   * const app = new Hono()
   * const app2 = new Hono()
   *
   * app2.get("/user", (c) => c.text("user"))
   * app.route("/api", app2) // GET /api/user
   * ```
   */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler;
      if (app2.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = /* @__PURE__ */ __name(async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res, "handler");
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler, r.basePath);
    });
    return this;
  }
  /**
   * `.basePath()` allows base paths to be specified.
   *
   * @see {@link https://hono.dev/docs/api/routing#base-path}
   *
   * @param {string} path - base Path
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * const api = new Hono().basePath('/api')
   * ```
   */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
   * `.onError()` handles an error and returns a customized Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#error-handling}
   *
   * @param {ErrorHandler} handler - request Handler for error
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.onError((err, c) => {
   *   console.error(`${err}`)
   *   return c.text('Custom Error Message', 500)
   * })
   * ```
   */
  onError = /* @__PURE__ */ __name((handler) => {
    this.errorHandler = handler;
    return this;
  }, "onError");
  /**
   * `.notFound()` allows you to customize a Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#not-found}
   *
   * @param {NotFoundHandler} handler - request handler for not-found
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.notFound((c) => {
   *   return c.text('Custom 404 Message', 404)
   * })
   * ```
   */
  notFound = /* @__PURE__ */ __name((handler) => {
    this.#notFoundHandler = handler;
    return this;
  }, "notFound");
  /**
   * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
   *
   * @see {@link https://hono.dev/docs/api/hono#mount}
   *
   * @param {string} path - base Path
   * @param {Function} applicationHandler - other Request Handler
   * @param {MountOptions} [options] - options of `.mount()`
   * @returns {Hono} mounted Hono instance
   *
   * @example
   * ```ts
   * import { Router as IttyRouter } from 'itty-router'
   * import { Hono } from 'hono'
   * // Create itty-router application
   * const ittyRouter = IttyRouter()
   * // GET /itty-router/hello
   * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
   *
   * const app = new Hono()
   * app.mount('/itty-router', ittyRouter.handle)
   * ```
   *
   * @example
   * ```ts
   * const app = new Hono()
   * // Send the request to another application without modification.
   * app.mount('/app', anotherApp, {
   *   replaceRequest: (req) => req,
   * })
   * ```
   */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = /* @__PURE__ */ __name((request) => request, "replaceRequest");
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = this.getPath(request).slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = /* @__PURE__ */ __name(async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    }, "handler");
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler, baseRoutePath) {
    path = mergePath(this._basePath, path);
    const r = {
      basePath: baseRoutePath !== void 0 ? mergePath(this._basePath, baseRoutePath) : this._basePath,
      path,
      method,
      handler
    };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    }
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))
      ).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
   * `.fetch()` will be entry point of your app.
   *
   * @see {@link https://hono.dev/docs/api/hono#fetch}
   *
   * @param {Request} request - request Object of request
   * @param {Env} env - env Object
   * @param {ExecutionContext} executionCtx - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = /* @__PURE__ */ __name((request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  }, "fetch");
  /**
   * `.request()` is a useful method for testing.
   * You can pass a URL or pathname to send a GET request.
   * app will return a Response object.
   * ```ts
   * test('GET /hello is ok', async () => {
   *   const res = await app.request('/hello')
   *   expect(res.status).toBe(200)
   * })
   * ```
   * @see https://hono.dev/docs/api/hono#request
   */
  request = /* @__PURE__ */ __name((input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env,
      executionCtx
    );
  }, "request");
  /**
   * `.fire()` automatically adds a global fetch event listener.
   * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
   * @deprecated
   * Use `fire` from `hono/service-worker` instead.
   * ```ts
   * import { Hono } from 'hono'
   * import { fire } from 'hono/service-worker'
   *
   * const app = new Hono()
   * // ...
   * fire(app)
   * ```
   * @see https://hono.dev/docs/api/hono#fire
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
   * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
   */
  fire = /* @__PURE__ */ __name(() => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  }, "fire");
};

// ../node_modules/hono/dist/router/utils.js
var createNullObject = /* @__PURE__ */ __name(() => /* @__PURE__ */ Object.create(null), "createNullObject");

// ../node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = /* @__PURE__ */ __name(((method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  }), "match2");
  this.match = match2;
  return match2(method, path);
}
__name(match, "match");

// ../node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return b === TAIL_WILDCARD_REG_EXP_STR ? -1 : 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
__name(compareKey, "compareKey");
var Node = class _Node {
  static {
    __name(this, "_Node");
  }
  // handler index of a dynamic path, or -1 for a static path terminal
  #index;
  #varIndex;
  #children = createNullObject();
  insert(tokens, index, paramMap, context, isStatic) {
    let node = this;
    for (let i = 0, len = tokens.length; i < len; i++) {
      const token = tokens[i];
      const pattern = token.length === 1 ? token === "*" ? i === len - 1 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : null : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
      let nextNode;
      if (pattern) {
        const name = pattern[1];
        let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
        if (name && pattern[2]) {
          if (regexpStr === ".*") {
            throw PATH_ERROR;
          }
          regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
          if (/\((?!\?:)/.test(regexpStr)) {
            throw PATH_ERROR;
          }
          if (regexpStr.length === 1 && regExpMetaChars.has(regexpStr)) {
            throw PATH_ERROR;
          }
        }
        nextNode = node.#children[regexpStr];
        if (!nextNode) {
          if (regexpStr !== ONLY_WILDCARD_REG_EXP_STR && regexpStr !== TAIL_WILDCARD_REG_EXP_STR) {
            for (const k in node.#children) {
              if (
                // a single-char pattern coexists with single-char literals as a literal does
                (regexpStr.length > 1 || k.length > 1) && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
              ) {
                throw PATH_ERROR;
              }
            }
          }
          nextNode = node.#children[regexpStr] = new _Node();
        }
        if (name !== "") {
          nextNode.#varIndex ??= context.varIndex++;
          paramMap.push([name, nextNode.#varIndex]);
        }
      } else {
        nextNode = node.#children[token];
        if (!nextNode) {
          for (const k in node.#children) {
            if (k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR) {
              throw PATH_ERROR;
            }
          }
          nextNode = node.#children[token] = new _Node();
        }
      }
      node = nextNode;
    }
    if (node.#index !== void 0) {
      throw PATH_ERROR;
    }
    node.#index = isStatic ? -1 : index;
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      const childStr = c.buildRegExpStr();
      return childStr === "" ? "" : (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + childStr;
    }).filter(Boolean);
    if (typeof this.#index === "number" && this.#index !== -1) {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};

// ../node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  static {
    __name(this, "Trie");
  }
  #context = { varIndex: 0 };
  #root = new Node();
  #index = 0;
  // dynamic path -> [handler index, param assoc]; static paths are not registered
  paths = createNullObject();
  insert(path, isStatic) {
    if (isStatic) {
      this.#root.insert(path.split(""), 0, [], this.#context, true);
      return;
    }
    const paramAssoc = [];
    const groups = [];
    let markedPath = path;
    for (let i = 0; ; ) {
      let replaced = false;
      markedPath = markedPath.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = markedPath.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, this.#index, paramAssoc, this.#context, false);
    this.paths[path] = [this.#index++, paramAssoc];
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};

// ../node_modules/hono/dist/router/reg-exp-router/router.js
var wildcardRegExpCache = createNullObject();
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    `^${path.replace(
      /\/:[^/{}]+(?:\{\[\^\/]\+})?(?=[/{]|$)|\/?\*$|([.\\+*[^\]$()?{}|])/g,
      (match2, metaChar) => metaChar ? `\\${metaChar}` : match2 === "/*" ? TAIL_WILDCARD_REG_EXP_STR : match2 === "*" ? ONLY_WILDCARD_REG_EXP_STR : `/:${LABEL_REG_EXP_STR}`
    )}$`
  );
}
__name(buildWildcardRegExp, "buildWildcardRegExp");
function findMiddleware(middleware, path) {
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
__name(findMiddleware, "findMiddleware");
var RegExpRouter = class {
  static {
    __name(this, "RegExpRouter");
  }
  name = "RegExpRouter";
  #middleware;
  #routes;
  #tries;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: createNullObject() };
    this.#routes = { [METHOD_NAME_ALL]: createNullObject() };
    this.#tries = { [METHOD_NAME_ALL]: new Trie() };
  }
  #insertPath(method, path) {
    try {
      this.#tries[method].insert(path, !/\*|\/:/.test(path));
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      this.#tries[method] = new Trie();
      for (const handlerMap of [middleware, routes]) {
        handlerMap[method] = createNullObject();
        for (const p in handlerMap[METHOD_NAME_ALL]) {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
          this.#insertPath(method, p);
        }
      }
    }
    if (path === "/*") {
      path = "*";
    }
    const methods = method === METHOD_NAME_ALL ? Object.keys(middleware) : [method];
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      for (const m of methods) {
        if (!middleware[m][path]) {
          this.#insertPath(m, path);
          middleware[m][path] = findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        }
      }
      for (const handlerMap of [middleware, routes]) {
        for (const m of methods) {
          for (const p in handlerMap[m]) {
            re.test(p) && handlerMap[m][p].push([handler, path]);
          }
        }
      }
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (const path2 of paths) {
      for (const m of methods) {
        if (!routes[m][path2]) {
          this.#insertPath(m, path2);
          routes[m][path2] = findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || [];
        }
        routes[m][path2].push([handler, path2]);
      }
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = createNullObject();
    for (const method of Object.keys(this.#routes)) {
      matchers[method] = this.#buildMatcher(method);
    }
    this.#middleware = this.#routes = this.#tries = void 0;
    wildcardRegExpCache = createNullObject();
    return matchers;
  }
  #buildMatcher(method) {
    const middleware = this.#middleware[method];
    const routes = this.#routes[method];
    const trie = this.#tries[method];
    const staticMap = createNullObject();
    const handlerData = [];
    const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
    for (const r of [middleware, routes]) {
      for (const path in r) {
        const handlers = r[path];
        const pathData = trie.paths[path];
        if (!pathData) {
          staticMap[path] = [handlers.map(([h]) => [h, createNullObject()]), emptyParam];
          continue;
        }
        handlerData[pathData[0]] = handlers.map(([h, handlerPath]) => [
          h,
          trie.paths[handlerPath][1].reduceRight((map, [key2], i) => {
            map[key2] = paramReplacementMap[pathData[1][i][1]];
            return map;
          }, createNullObject())
        ]);
      }
    }
    return [regexp, indexReplacementMap.map((i) => handlerData[i]), staticMap];
  }
};

// ../node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  static {
    __name(this, "SmartRouter");
  }
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};

// ../node_modules/hono/dist/router/trie-router/node.js
var emptyParams = createNullObject();
var order = 0;
var Node2 = class _Node2 {
  static {
    __name(this, "_Node");
  }
  #methods = [];
  #children = createNullObject();
  #patterns = [];
  #pattern;
  #params = emptyParams;
  insert(method, path, handler) {
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = /* @__PURE__ */ new Set();
    let i = 0;
    for (const p of parts) {
      const nextP = parts[++i];
      const pattern = getPattern(p, nextP) || (nextP === void 0 && p && p.indexOf("*") === p.length - 1 ? p : null);
      const isParam = Array.isArray(pattern);
      const key2 = isParam ? pattern[0] : pattern || p;
      const child = curNode.#children[key2] ||= new _Node2();
      if (pattern && !child.#pattern) {
        child.#pattern = pattern;
        curNode.#patterns.push(child);
      }
      curNode = child;
      if (isParam) {
        possibleKeys.add(pattern[1]);
      }
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: [...possibleKeys],
        score: ++order
      }
    });
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      if (handlerSet) {
        handlerSet.params = createNullObject();
        handlerSets.push(handlerSet);
        for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
          const key2 = handlerSet.possibleKeys[i2];
          handlerSet.params[key2] = params?.[key2] && !i2 ? params[key2] : nodeParams[key2] ?? params?.[key2];
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            }
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (const child of node.#patterns) {
          const pattern = child.#pattern;
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (typeof pattern === "string") {
            if (pattern === "*" || part.startsWith(pattern.slice(0, -1))) {
              this.#pushHandlerSets(handlerSets, child, method, node.#params);
              if (pattern === "*") {
                child.#params = params;
                tempNodes.push(child);
              }
            }
            continue;
          }
          const [, name, matcher] = pattern;
          if (!part && matcher === true) {
            continue;
          }
          if (matcher !== true) {
            if (!partOffsets) {
              partOffsets = [];
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.slice(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (m[0].length === restPathString.length && child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  node.#params,
                  params
                );
              }
              for (const _ in child.#children) {
                child.#params = params;
                const componentCount = m[0].match(/\//g)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
                break;
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  params,
                  node.#params
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets[1]) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// ../node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  static {
    __name(this, "TrieRouter");
  }
  name = "TrieRouter";
  #node = new Node2();
  add(method, path, handler) {
    for (const result of checkOptionalParameter(path) || [path]) {
      this.#node.insert(method, result, handler);
    }
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// ../node_modules/hono/dist/hono.js
var Hono2 = class extends Hono {
  static {
    __name(this, "Hono");
  }
  /**
   * Creates an instance of the Hono class.
   *
   * @param options - Optional configuration options for the Hono instance.
   */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
};

// src/shared/auth.ts
function checkAuth(req, env) {
  const token = env.ADMIN_PUSH_TOKEN;
  if (!token) return false;
  const header = req.headers.get("Authorization");
  if (!header) return false;
  if (!header.startsWith("Bearer ")) return false;
  const presented = header.slice("Bearer ".length);
  if (presented.length !== token.length) return false;
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return mismatch === 0;
}
__name(checkAuth, "checkAuth");

// src/shared/path.ts
var ALLOWED_PREFIXES = ["dists/", "pool/"];
var ALLOWED_EXACT = ["pubkey.asc", "scripts/install.sh", "scripts/uninstall.sh"];
var SUITE_RE = /^[a-z0-9][a-z0-9.+~-]{0,63}$/;
function validateSuite(s) {
  return typeof s === "string" && SUITE_RE.test(s);
}
__name(validateSuite, "validateSuite");
function isPathSafe(p) {
  if (!p) return false;
  if (p.startsWith("/")) return false;
  if (p.includes("..")) return false;
  if (p.includes("\0")) return false;
  return true;
}
__name(isPathSafe, "isPathSafe");
function validateUploadPath(path) {
  if (!isPathSafe(path)) {
    return { ok: false, error: "Path is unsafe (traversal/absolute/null)" };
  }
  if (ALLOWED_EXACT.includes(path)) {
    return { ok: true, key: path };
  }
  for (const prefix of ALLOWED_PREFIXES) {
    if (path === prefix.replace(/\/$/, "")) {
      return { ok: false, error: "Empty upload path" };
    }
    if (path.startsWith(prefix)) {
      if (path === prefix) {
        return { ok: false, error: "Empty upload path" };
      }
      if (path.length > prefix.length) {
        return { ok: true, key: path };
      }
    }
  }
  return { ok: false, error: `Path not in whitelist. Allowed: ${[...ALLOWED_PREFIXES, ...ALLOWED_EXACT].join(", ")}` };
}
__name(validateUploadPath, "validateUploadPath");

// src/releases.ts
function safeRelative(name) {
  if (!name) return false;
  if (name.startsWith("/")) return false;
  const parts = name.split("/");
  for (const part of parts) if (part === "" || part === "." || part === "..") return false;
  for (const ch of name) if (ch === "\\" || ch === "\0" || ch === "\r" || ch === "\n") return false;
  return true;
}
__name(safeRelative, "safeRelative");
var releaseKey = /* @__PURE__ */ __name((suite) => `releases/${suite}.json`, "releaseKey");
var RELEASE_ID = /^[a-f0-9]{32}$/;
var SHA256 = /^[a-f0-9]{64}$/;
var ARCH = /^[a-z0-9][a-z0-9.+-]{0,31}$/;
function validatePackage(record) {
  if (!record || typeof record !== "object") return false;
  const r = record;
  if (typeof r.package !== "string" || !/^[a-z0-9][a-z0-9.+-]{1,62}$/.test(r.package)) return false;
  if (typeof r.version !== "string" || r.version.length === 0 || r.version.length > 128) return false;
  if (typeof r.architecture !== "string" || !ARCH.test(r.architecture)) return false;
  if (typeof r.filename !== "string" || !safeRelative(r.filename) || !r.filename.startsWith("pool/")) return false;
  if (typeof r.sha256 !== "string" || !SHA256.test(r.sha256)) return false;
  if (!Number.isSafeInteger(r.size) || r.size <= 0) return false;
  return true;
}
__name(validatePackage, "validatePackage");
function isImmutable(key2) {
  return key2.startsWith("pool/") || key2.includes("/by-hash/") || key2.includes("/.snapshots/");
}
__name(isImmutable, "isImmutable");
async function resolveIndexKey(bucket, key2) {
  const match2 = /^dists\/([^/]+)\/(.+)$/.exec(key2);
  if (!match2 || key2.includes("/by-hash/") || key2.includes("/.snapshots/")) return key2;
  const current = await bucket.get(releaseKey(match2[1]));
  if (!current) return key2;
  const { release } = await current.json();
  if (!RELEASE_ID.test(release)) throw new Error("Invalid current release");
  return `dists/${match2[1]}/.snapshots/${release}/${match2[2]}`;
}
__name(resolveIndexKey, "resolveIndexKey");
async function handlePublish(req, suite, env) {
  if (!checkAuth(req, env)) return new Response("Unauthorized", { status: 401 });
  if (!validateSuite(suite)) return new Response("Invalid suite", { status: 400 });
  const bucket = env.APT_BUCKET;
  if (!bucket) return new Response("R2 not bound", { status: 500 });
  if (req.method === "GET") {
    const current2 = await bucket.get(releaseKey(suite));
    if (!current2) {
      return Response.json(
        { release: null, etag: null, packages: [] },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    const data2 = await current2.json();
    return Response.json({
      release: data2.release,
      etag: current2.etag,
      packages: data2.packages ?? []
    }, { headers: { "Cache-Control": "no-store" } });
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  let data;
  try {
    const body = await req.text();
    if (body.length > 1024 * 1024) return new Response("Manifest too large", { status: 413 });
    const parsed = JSON.parse(body);
    if (!parsed || !RELEASE_ID.test(parsed.release) || !(parsed.previous === null || typeof parsed.previous === "string") || !Array.isArray(parsed.files) || !parsed.files.length) throw new Error();
    data = parsed;
    const prefix = `dists/${suite}/.snapshots/${data.release}/`;
    const seen = /* @__PURE__ */ new Set();
    for (const f of data.files) {
      if (!f || typeof f.key !== "string" || !validateUploadPath(f.key).ok || !SHA256.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0 || seen.has(f.key) || !(f.key.startsWith(prefix) || f.key.startsWith("pool/") || f.key.startsWith(`dists/${suite}/`) && /\/by-hash\/SHA256\/[a-f0-9]{64}$/.test(f.key))) throw new Error();
      if (f.key.includes("/by-hash/") && !f.key.endsWith(`/${f.sha256}`)) throw new Error();
      seen.add(f.key);
    }
    for (const name of ["InRelease", "Release", "Release.gpg"]) {
      if (!seen.has(prefix + name)) throw new Error();
    }
    const packages = Array.isArray(data.packages) ? data.packages : [];
    const packageFilenames = /* @__PURE__ */ new Set();
    for (const p of packages) {
      if (!validatePackage(p)) throw new Error();
      if (packageFilenames.has(p.filename)) throw new Error();
      packageFilenames.add(p.filename);
    }
    data.packages = packages;
  } catch {
    return new Response("Invalid publication manifest", { status: 400 });
  }
  const current = await bucket.get(releaseKey(suite));
  const active = current ? await current.json() : null;
  const canonical = JSON.stringify([...data.files].sort((a, b) => a.key.localeCompare(b.key)));
  const manifest = await digest(new TextEncoder().encode(canonical));
  if (active) {
    if (active.release === data.release) {
      return active.manifest === manifest ? new Response("OK") : new Response("Release id reused", { status: 409 });
    }
  }
  if ((current?.etag ?? null) !== data.previous) return new Response("Another publication won; sync again", { status: 409 });
  const groups = /* @__PURE__ */ new Map();
  for (const f of data.files) {
    const prefix = f.key.startsWith("pool/") ? "pool/" : f.key.slice(0, f.key.lastIndexOf("/") + 1);
    if (!groups.has(prefix)) groups.set(prefix, /* @__PURE__ */ new Map());
    groups.get(prefix).set(f.key, f);
  }
  for (const [prefix, pending] of groups) {
    let cursor;
    do {
      const options = { prefix, cursor, include: ["customMetadata"] };
      const result = await bucket.list(options);
      for (const obj of result.objects) {
        const expected = pending.get(obj.key);
        if (!expected) continue;
        if (obj.size !== expected.size || obj.customMetadata?.sha256 !== expected.sha256) {
          return new Response(`Unverified file: ${obj.key}`, { status: 409 });
        }
        pending.delete(obj.key);
      }
      cursor = result.truncated ? result.cursor : void 0;
    } while (cursor && pending.size);
    if (pending.size) return new Response(`Missing file: ${pending.keys().next().value}`, { status: 409 });
  }
  const committed = await bucket.put(
    releaseKey(suite),
    JSON.stringify({ release: data.release, manifest, packages: data.packages ?? [] }),
    {
      onlyIf: current ? { etagMatches: current.etag } : { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json", cacheControl: "no-store" }
    }
  );
  return committed ? new Response("OK") : new Response("Concurrent publication; sync again", { status: 409 });
}
__name(handlePublish, "handlePublish");
async function digest(body) {
  const bytes = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(digest, "digest");

// src/proxy.ts
async function proxyR2(env, key2, contentType) {
  const bucket = env.APT_BUCKET;
  if (!bucket) return new Response("R2 not bound", { status: 500 });
  try {
    key2 = decodeURIComponent(key2);
  } catch {
    return new Response("Invalid path encoding", { status: 400 });
  }
  if (key2.includes("/.snapshots/")) return new Response("Not Found", { status: 404 });
  const obj = await bucket.get(await resolveIndexKey(bucket, key2));
  if (!obj) return new Response("Not Found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Cache-Control", key2.includes("/by-hash/") ? "public, max-age=31536000, immutable" : key2.startsWith("dists/") ? "no-store" : "public, max-age=300");
  if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(obj.body, { headers });
}
__name(proxyR2, "proxyR2");

// src/upload.ts
async function handleUpload(req, env) {
  if (req.method !== "PUT" && req.method !== "DELETE") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!checkAuth(req, env)) {
    return new Response("unauthorized", { status: 401 });
  }
  const url = new URL(req.url);
  let rawPath;
  try {
    rawPath = decodeURIComponent(url.pathname.replace(/^\/api\/upload\//, ""));
  } catch {
    return new Response("Invalid path encoding", { status: 400 });
  }
  const validated = validateUploadPath(rawPath);
  if (!validated.ok) {
    return new Response(`Bad Request: ${validated.error}`, { status: 400 });
  }
  const bucket = env.APT_BUCKET;
  if (!bucket) return new Response("R2 not bound", { status: 500 });
  if (req.method === "PUT") {
    const contentType = req.headers.get("Content-Type") || "application/octet-stream";
    let allowed;
    if (validated.key.startsWith("pool/")) {
      allowed = ["application/octet-stream", "application/vnd.debian.binary-package"];
    } else if (validated.key.startsWith("dists/")) {
      allowed = ["text/plain", "application/x-gzip", "application/gzip", "application/x-xz", "application/octet-stream"];
    } else if (ALLOWED_EXACT.includes(validated.key)) {
      allowed = ["text/plain", "text/plain; charset=utf-8", "application/octet-stream"];
    } else {
      return new Response("Invalid upload path", { status: 400 });
    }
    if (!allowed.some((p) => contentType.toLowerCase().startsWith(p))) {
      return new Response(`Invalid Content-Type for ${validated.key}`, { status: 400 });
    }
    const body = await req.arrayBuffer();
    const sha2562 = await digest(body);
    if (req.headers.has("X-Content-SHA256") && req.headers.get("X-Content-SHA256") !== sha2562) {
      return new Response("Checksum mismatch", { status: 400 });
    }
    if (isImmutable(validated.key)) {
      let saved = await bucket.put(validated.key, body, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType },
        customMetadata: { sha256: sha2562 }
      });
      if (!saved) {
        const existing = await bucket.head(validated.key);
        let existingHash = existing?.customMetadata?.sha256;
        if (existing && !existingHash) {
          const legacy = await bucket.get(validated.key);
          if (legacy) existingHash = await digest(await legacy.arrayBuffer());
        }
        if (!existing || existingHash !== sha2562) {
          return new Response("Immutable file differs; use a new package version", { status: 409 });
        }
        if (!existing.customMetadata?.sha256) {
          saved = await bucket.put(validated.key, body, {
            onlyIf: { etagMatches: existing.etag },
            httpMetadata: { contentType },
            customMetadata: { sha256: sha2562 }
          });
          if (!saved) return new Response("Concurrent upload; retry", { status: 409 });
        }
      }
    } else {
      await bucket.put(validated.key, body, { httpMetadata: { contentType }, customMetadata: { sha256: sha2562 } });
    }
    return new Response("OK", { headers: { "X-Content-SHA256": sha2562 } });
  } else {
    if (isImmutable(validated.key)) return new Response("Retained publication file cannot be deleted", { status: 409 });
    await bucket.delete(validated.key);
  }
  return new Response("OK", { status: 200 });
}
__name(handleUpload, "handleUpload");

// src/cache.ts
var TTL_SECONDS = 300;
var ARCHS = ["amd64", "arm64"];
function key(suite, arch) {
  return `index:${suite}:${arch}`;
}
__name(key, "key");
async function getCachedIndex(env, suite, arch) {
  const kv = env.APT_KV;
  if (!kv) return null;
  const v = await kv.get(key(suite, arch));
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
__name(getCachedIndex, "getCachedIndex");
async function setCachedIndex(env, suite, arch, value) {
  const kv = env.APT_KV;
  if (!kv) return;
  await kv.put(key(suite, arch), JSON.stringify(value), { expirationTtl: TTL_SECONDS });
}
__name(setCachedIndex, "setCachedIndex");
async function invalidate(env, suite) {
  const kv = env.APT_KV;
  if (!kv) return;
  await Promise.all(ARCHS.map((a) => kv.delete(key(suite, a))));
}
__name(invalidate, "invalidate");

// src/parser.ts
var OPTIONAL_FIELDS = ["Description", "Depends", "Maintainer", "Section", "Priority"];
function parsePackages(text) {
  const entries = [];
  for (const block of text.split(/\n\n+/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const fields = {};
    let currentKey = "";
    let currentValue = "";
    for (const line of trimmed.split("\n")) {
      if (/^\s/.test(line) && currentKey) {
        currentValue += " " + line.trim();
      } else {
        if (currentKey) fields[currentKey] = currentValue;
        const m = line.match(/^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/);
        if (m) {
          currentKey = m[1];
          currentValue = m[2];
        }
      }
    }
    if (currentKey) fields[currentKey] = currentValue;
    if (!fields.Package || !fields.Version || !fields.Architecture || !fields.Filename) continue;
    const entry = {
      Package: fields.Package,
      Version: fields.Version,
      Architecture: fields.Architecture,
      Size: parseInt(fields.Size || "0", 10),
      Filename: fields.Filename
    };
    for (const f of OPTIONAL_FIELDS) {
      if (fields[f]) entry[f] = fields[f];
    }
    entries.push(entry);
  }
  return entries;
}
__name(parsePackages, "parsePackages");

// src/api-index.ts
var ARCHS2 = ["amd64", "arm64"];
function jsonError(status, message) {
  return Response.json({ packages: [], error: message }, { status });
}
__name(jsonError, "jsonError");
async function loadIndex(env, suite, arch) {
  try {
    const bucket = env.APT_BUCKET;
    if (!bucket) return [];
    const obj = await bucket.get(await resolveIndexKey(bucket, `dists/${suite}/main/binary-${arch}/Packages.gz`));
    if (!obj) return [];
    const etag = obj.httpEtag;
    const cached = await getCachedIndex(env, suite, arch);
    if (cached && cached.etag === etag) {
      await obj.body?.cancel();
      return cached.entries;
    }
    const stream = new Response(obj.body).body.pipeThrough(new DecompressionStream("gzip"));
    const text = await new Response(stream).text();
    const entries = parsePackages(text);
    await setCachedIndex(env, suite, arch, { etag, entries });
    return entries;
  } catch (e) {
    console.error(`loadIndex(${suite}, ${arch}) failed:`, e);
    return [];
  }
}
__name(loadIndex, "loadIndex");
async function handleIndex(suite, arch, env) {
  if (!validateSuite(suite)) return jsonError(400, "Invalid suite");
  if (!ARCHS2.includes(arch)) return jsonError(400, "Invalid arch");
  try {
    const entries = await loadIndex(env, suite, arch);
    return Response.json({ packages: entries });
  } catch (e) {
    console.error(`handleIndex(${suite}, ${arch}) failed:`, e);
    return jsonError(500, e instanceof Error ? e.message : "unknown error");
  }
}
__name(handleIndex, "handleIndex");
async function handleSearch(suite, arch, query, env) {
  if (!validateSuite(suite)) return jsonError(400, "Invalid suite");
  if (!ARCHS2.includes(arch)) return jsonError(400, "Invalid arch");
  try {
    const all = await loadIndex(env, suite, arch);
    const q = query.toLowerCase();
    const filtered = all.filter(
      (p) => p.Package.toLowerCase().includes(q) || (p.Description || "").toLowerCase().includes(q) || (p.Depends || "").toLowerCase().includes(q)
    );
    return Response.json({ packages: filtered });
  } catch (e) {
    console.error(`handleSearch(${suite}, ${arch}, ${query}) failed:`, e);
    return jsonError(500, e instanceof Error ? e.message : "unknown error");
  }
}
__name(handleSearch, "handleSearch");

// src/index.ts
var app = new Hono2();
app.post("/api/invalidate", async (c) => {
  if (!checkAuth(c.req.raw, c.env)) return c.text("Unauthorized", 401);
  const suite = c.req.query("suite");
  if (!suite) return c.text("Missing suite", 400);
  await invalidate(c.env, suite);
  return c.text("OK");
});
app.all("/api/upload/*", (c) => handleUpload(c.req.raw, c.env));
app.all("/api/publish/:suite", (c) => handlePublish(c.req.raw, c.req.param("suite"), c.env));
app.get(
  "/api/index/:suite/:arch",
  (c) => handleIndex(c.req.param("suite"), c.req.param("arch"), c.env)
);
app.get(
  "/api/index/:suite/:arch/search",
  (c) => handleSearch(c.req.param("suite"), c.req.param("arch"), c.req.query("q") || "", c.env)
);
app.get("/dists/*", (c) => proxyR2(c.env, c.req.path.slice(1)));
app.get("/pool/*", (c) => proxyR2(c.env, c.req.path.slice(1)));
app.get("/pubkey.asc", (c) => proxyR2(c.env, "pubkey.asc", "text/plain"));
app.get("/install.sh", (c) => proxyR2(c.env, "scripts/install.sh", "text/plain; charset=utf-8"));
app.get("/uninstall.sh", (c) => proxyR2(c.env, "scripts/uninstall.sh", "text/plain; charset=utf-8"));
app.get("/api/status/health", (c) => c.json({ status: "ok" }));
app.get("*", async (c) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/dists/") || url.pathname.startsWith("/pool/")) {
    return c.notFound();
  }
  if (!c.env.ASSETS) return c.text("SPA assets not built", { status: 500 });
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const ct = res.headers.get("Content-Type") || "";
  if (!ct.includes("text/html")) {
    return res;
  }
  const h = new Headers(res.headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("X-Frame-Options", "DENY");
  h.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src * data:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';");
  return new Response(res.body, { status: res.status, headers: h });
});
var index_default = app;
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
