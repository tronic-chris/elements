import CustomVideoElement from "./CustomVideoElement.js";
import mux, { Options, HighPriorityMetadata } from "mux-embed";

import Hls from "hls.js";
import { getPlayerVersion } from "./env.js";

type Metadata = Partial<Options["data"]>;

/** @TODO make the relationship between name+value smarter and more deriveable (CJP) */
type AttributeNames = {
  ENV_KEY: "env-key";
  DEBUG: "debug";
  METADATA_URL: "metadata-url";
  METADATA_VIDEO_ID: "metadata-video-id";
  METADATA_VIDEO_TITLE: "metadata-video-title";
  METADATA_VIEWER_USER_ID: "metadata-viewer-user-id";
  BEACON_DOMAIN: "beacon-domain";
  PLAYBACK_ID: "playback-id";
  PREFER_MSE: "prefer-mse";
  TYPE: "type";
  STREAM_TYPE: "stream-type";
};

const Attributes: AttributeNames = {
  ENV_KEY: "env-key",
  DEBUG: "debug",
  PLAYBACK_ID: "playback-id",
  METADATA_URL: "metadata-url",
  PREFER_MSE: "prefer-mse",
  METADATA_VIDEO_ID: "metadata-video-id",
  METADATA_VIDEO_TITLE: "metadata-video-title",
  METADATA_VIEWER_USER_ID: "metadata-viewer-user-id",
  BEACON_DOMAIN: "beacon-domain",
  TYPE: "type",
  STREAM_TYPE: "stream-type",
};

const AttributeNameValues = Object.values(Attributes);

const toPlaybackIdParts = (
  playbackIdWithOptionalParams: string
): [string, string?] => {
  const qIndex = playbackIdWithOptionalParams.indexOf("?");
  if (qIndex < 0) return [playbackIdWithOptionalParams];
  const idPart = playbackIdWithOptionalParams.slice(0, qIndex);
  const queryPart = playbackIdWithOptionalParams.slice(qIndex);
  return [idPart, queryPart];
};

const toMuxVideoURL = (playbackId: string | null) => {
  if (!playbackId) return null;
  const [idPart, queryPart = ""] = toPlaybackIdParts(playbackId);
  return `https://stream.mux.com/${idPart}.m3u8${queryPart}`;
};

type HTMLVideoElementWithMux = HTMLVideoElement & { mux?: typeof mux };

const getHighPriorityMetadata = (
  mediaEl: MuxVideoElement
): Partial<HighPriorityMetadata> => {
  const video_title = mediaEl.getAttribute(Attributes.METADATA_VIDEO_TITLE);
  const viewer_id = mediaEl.getAttribute(Attributes.METADATA_VIEWER_USER_ID);
  const video_id = mediaEl.getAttribute(Attributes.METADATA_VIDEO_ID);
  const videoTitleObj = video_title ? { video_title } : {};
  const viewerIdObj = viewer_id ? { viewer_id } : {};
  const videoIdObj = video_id ? { video_id } : {};
  return {
    ...videoTitleObj,
    ...viewerIdObj,
    ...videoIdObj,
  };
};

const ExtensionMimeTypeMap: { [k: string]: string } = {
  M3U8: "application/vnd.apple.mpegurl",
};

const MimeTypeShorthandMap: { [k: string]: string } = {
  HLS: ExtensionMimeTypeMap.M3U8,
};

const inferMimeTypeFromURL = (url: string) => {
  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch (e) {
    console.error("invalid url");
  }

  const extDelimIdx = pathname.lastIndexOf(".");
  if (extDelimIdx < 0) return "";
  const ext = pathname.slice(extDelimIdx + 1);
  return ExtensionMimeTypeMap[ext.toUpperCase()] ?? "";
};

const getType = (mediaEl: MuxVideoElement) => {
  const type = mediaEl.getAttribute(Attributes.TYPE);
  if (type) return MimeTypeShorthandMap[type.toUpperCase()] ?? type;
  const src = mediaEl.getAttribute("src");
  if (!src) return "";
  return inferMimeTypeFromURL(src);
};

type StreamTypes = {
  VOD: "vod";
  LIVE: "live";
  LL_LIVE: "ll-live";
};

const StreamTypes: StreamTypes = {
  VOD: "vod",
  LIVE: "live",
  LL_LIVE: "ll-live",
};

type ValueOf<T> = T[keyof T];

const getStreamTypeConfig = (streamType?: ValueOf<StreamTypes>) => {
  if (streamType === StreamTypes.LL_LIVE) {
    return {
      maxFragLookUpTolerance: 0.001,
    };
  }
  return {};
};

class MuxVideoElement extends CustomVideoElement<HTMLVideoElementWithMux> {
  static get observedAttributes() {
    return [
      ...AttributeNameValues,
      ...(CustomVideoElement.observedAttributes ?? []),
    ];
  }

  protected __hls?: Hls;
  protected __muxPlayerInitTime: number;
  protected __metadata: Readonly<Metadata> = {};

  constructor() {
    super();
    this.__muxPlayerInitTime = Date.now();
  }

  get hls() {
    return this.__hls;
  }

  get mux(): Readonly<typeof mux> | undefined {
    return this.nativeEl.mux;
  }

  get src() {
    // Use the attribute value as the source of truth.
    // No need to store it in two places.
    // This avoids needing a to read the attribute initially and update the src.
    return this.getAttribute("src");
  }

  set src(val) {
    // If being set by attributeChangedCallback,
    // dont' cause an infinite loop
    if (val === this.src) return;

    if (val == null) {
      this.removeAttribute("src");
    } else {
      this.setAttribute("src", val);
    }
  }

  /** @TODO write a generic module for well defined primitive types -> attribute getter/setters/removers (CJP) */
  get debug(): boolean {
    return this.getAttribute(Attributes.DEBUG) != null;
  }

  set debug(val: boolean) {
    // dont' cause an infinite loop
    if (val === this.debug) return;

    if (val) {
      this.setAttribute(Attributes.DEBUG, "");
    } else {
      this.removeAttribute(Attributes.DEBUG);
    }
  }

  get beaconDomain(): string | undefined {
    return this.getAttribute(Attributes.BEACON_DOMAIN) ?? undefined;
  }

  set beaconDomain(val: string | undefined) {
    // dont' cause an infinite loop
    if (val === this.beaconDomain) return;

    if (val) {
      this.setAttribute(Attributes.BEACON_DOMAIN, val);
    } else {
      this.removeAttribute(Attributes.BEACON_DOMAIN);
    }
  }

  get streamType(): ValueOf<StreamTypes> | undefined {
    // getAttribute doesn't know that this attribute is well defined. Should explore extending for MuxVideo (CJP)
    return (
      (this.getAttribute(Attributes.STREAM_TYPE) as ValueOf<StreamTypes>) ??
      undefined
    );
  }

  set streamType(val: ValueOf<StreamTypes> | undefined) {
    // dont' cause an infinite loop
    if (val === this.streamType) return;

    if (val) {
      this.setAttribute(Attributes.STREAM_TYPE, val);
    } else {
      this.removeAttribute(Attributes.STREAM_TYPE);
    }
  }

  /** @TODO Followup: naming convention: all lower (common per HTMLElement props) vs. camel (common per JS convention) (CJP) */
  get preferMSE(): boolean {
    return this.getAttribute(Attributes.PREFER_MSE) != null;
  }

  set preferMSE(val: boolean) {
    if (val) {
      this.setAttribute(Attributes.PREFER_MSE, "");
    } else {
      this.removeAttribute(Attributes.PREFER_MSE);
    }
  }

  get metadata() {
    return this.__metadata;
  }

  set metadata(val: Readonly<Metadata> | undefined) {
    this.__metadata = val ?? {};
    if (!!this.mux) {
      this.mux.emit("hb", this.__metadata);
    }
  }

  /** @TODO Refactor as an independent function (CJP) */
  load() {
    /** @TODO Add custom errors + error codes */
    if (!this.src) {
      console.error("DONT DO THIS");
      return;
    }

    const env_key = this.getAttribute(Attributes.ENV_KEY);
    const debug = this.debug;
    const preferMSE = this.preferMSE;
    const type = getType(this);
    const hlsType = type === ExtensionMimeTypeMap.M3U8;

    const canUseNative = !type || this.nativeEl.canPlayType(type);
    const hlsSupported = Hls.isSupported();

    // We should use native playback for hls media sources if we a) can use native playback and don't also b) prefer to use MSE/hls.js if/when it's supported
    const shouldUseNative =
      !hlsType || (canUseNative && !(preferMSE && hlsSupported));

    // 1. if we are trying to play an hls media source create hls if we should be using it "under the hood"
    if (hlsType && !shouldUseNative && hlsSupported) {
      const streamTypeConfig = getStreamTypeConfig(this.streamType);
      const hls = new Hls({
        // Kind of like preload metadata, but causes spinner.
        // autoStartLoad: false,
        debug,
        ...streamTypeConfig,
      });

      this.__hls = hls;
    }

    // 2. Start monitoring for mux data before we do anything else
    if (env_key) {
      const player_init_time = this.__muxPlayerInitTime;
      const metadataObj = this.__metadata;
      const hlsjs = this.__hls; // an instance of hls.js or undefined
      const beaconDomain = this.beaconDomain;
      const highPriorityMetadata = getHighPriorityMetadata(this);
      /**
       * @TODO Use documented version if/when resolved (commented out below) (CJP)
       * @see https://github.com/snowpackjs/snowpack/issues/3621
       * @see https://www.snowpack.dev/reference/environment-variables#option-2-config-file
       */
      // @ts-ignore
      const player_version = getPlayerVersion();

      mux.monitor(this.nativeEl, {
        debug,
        beaconDomain,
        hlsjs,
        Hls: hlsjs ? Hls : undefined,
        data: {
          env_key, // required
          // Metadata fields
          player_name: "mux-video", // default player name for "mux-video"
          player_version,
          player_init_time,
          // Use any metadata passed in programmatically (which may override the defaults above)
          ...metadataObj,
          // Use any high priority metadata passed in via attributes (which may override any of the above)
          ...highPriorityMetadata,
        },
      });
    }

    // 3. Finish any additional setup to load/play the media
    if (canUseNative && shouldUseNative) {
      this.nativeEl.src = this.src;
    } else if (this.__hls) {
      const hls = this.__hls;

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // try to recover network error
              console.error("fatal network error encountered, try to recover");
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error("fatal media error encountered, try to recover");
              hls.recoverMediaError();
              break;
            default:
              // cannot recover
              console.error(
                "unrecoverable fatal error encountered, cannot recover (check logs for more info)"
              );
              hls.destroy();
              break;
          }
        }
      });

      hls.loadSource(this.src);
      hls.attachMedia(this.nativeEl);
    } else {
      console.error(
        "It looks like HLS video playback will not work on this system! If possible, try upgrading to the newest versions of your browser or software."
      );
      return;
    }
  }

  unload() {
    // NOTE: I believe we cannot reliably "recycle" hls player instances, but should confirm at least for optimization reasons.
    if (this.__hls) {
      this.__hls.detachMedia();
      this.__hls.destroy();
      this.__hls = undefined;
    }
    if (this.nativeEl.mux) {
      this.nativeEl.mux.destroy();
      delete this.nativeEl.mux;
    }
  }

  // NOTE: This was carried over from hls-video-element. Is it needed for an edge case?
  // play() {
  //   if (this.readyState === 0 && this.networkState < 2) {
  //     this.load();
  //     this.hls.on(Hls.Events.MANIFEST_PARSED,function() {
  //     video.play();
  //
  //     return this.nativeEl.play();
  //   }
  // }

  attributeChangedCallback(
    attrName: string,
    oldValue: string | null,
    newValue: string | null
  ) {
    switch (attrName) {
      case "src":
        const hadSrc = !!oldValue;
        const hasSrc = !!newValue;
        if (!hadSrc && hasSrc) {
          this.load();
        } else if (hadSrc && !hasSrc) {
          this.unload();
          /** @TODO Test this thoroughly (async?) and confirm unload() necessary (CJP) */
        } else if (hadSrc && hasSrc) {
          this.unload();
          this.load();
        }
        break;
      case Attributes.PLAYBACK_ID:
        /** @TODO Improv+Discuss - how should playback-id update wrt src attr changes (and vice versa) (CJP) */
        this.src = toMuxVideoURL(newValue);
        break;
      case Attributes.DEBUG:
        const debug = this.debug;
        if (!!this.mux) {
          /** @TODO Link to docs for a more detailed discussion (CJP) */
          console.info(
            "Cannot toggle debug mode of mux data after initialization. Make sure you set all metadata to override before setting the src."
          );
        }
        if (!!this.hls) {
          this.hls.config.debug = debug;
        }
        break;
      case Attributes.METADATA_URL:
        if (newValue) {
          fetch(newValue)
            .then((resp) => resp.json())
            .then((json) => (this.metadata = json))
            .catch((_err) =>
              console.error(
                `Unable to load or parse metadata JSON from metadata-url ${newValue}!`
              )
            );
        }
        break;
      default:
        break;
    }

    super.attributeChangedCallback(attrName, oldValue, newValue);
  }

  disconnectedCallback() {
    this.unload();
  }

  /** @TODO Followup - investigate why this is necessary (attributeChanged not invoked on initial load when setting playback-id) (CJP) */
  connectedCallback() {
    // Only auto-load if we have a src
    if (this.src) {
      this.load();
    }

    // NOTE: This was carried over from hls-video-element. Is it needed for an edge case?
    // Not preloading might require faking the play() promise
    // so that you can call play(), call load() within that
    // But wait until MANIFEST_PARSED to actually call play()
    // on the nativeEl.
    // if (this.preload === 'auto') {
    //   this.load();
    // }
  }
}

type MuxVideoElementType = typeof MuxVideoElement;
declare global {
  var MuxVideoElement: MuxVideoElementType;
}

/** @TODO Refactor once using `globalThis` polyfills */
if (!globalThis.customElements.get("mux-video")) {
  globalThis.customElements.define("mux-video", MuxVideoElement);
  /** @TODO consider externalizing this (breaks standard modularity) */
  globalThis.MuxVideoElement = MuxVideoElement;
}

export { Hls, ExtensionMimeTypeMap as MimeTypes };

export default MuxVideoElement;
