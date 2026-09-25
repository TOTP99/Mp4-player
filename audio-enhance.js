/**
 * audio-enhance.js —— 视频 / 影音音质与响度处理（独立模块）
 *
 * 针对 mp4 对白 + 音效：高通/低通降噪、压缩、AGC 响度平衡、软限幅。
 *   const enh = createAudioEnhancer(audioContext);
 *   enh.connectFrom(mediaElementSource, destination);
 *   enh.resetAgc() / setEnabled(false) / setWet(0)
 */
(function (global) {
  "use strict";

  var DEFAULTS = {
    highpassHz: 85,
    lowpassHz: 14000,
    compThreshold: -24,
    compKnee: 12,
    compRatio: 3.2,
    compAttack: 0.008,
    compRelease: 0.25,
    targetRms: 0.10,
    agcMin: 0.5,
    agcMax: 2.0,
    silenceRms: 0.012,
    agcSmooth: 0.045,
    wet: 1,
    limiterThreshold: 0.92,
  };

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function createAudioEnhancer(ctx, opts) {
    if (!ctx) return null;
    var cfg = {};
    var k;
    for (k in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) cfg[k] = DEFAULTS[k];
    }
    if (opts) {
      for (k in opts) {
        if (Object.prototype.hasOwnProperty.call(opts, k)) cfg[k] = opts[k];
      }
    }

    var highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = cfg.highpassHz;
    highpass.Q.value = 0.707;

    var lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = cfg.lowpassHz;
    lowpass.Q.value = 0.707;

    var compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = cfg.compThreshold;
    compressor.knee.value = cfg.compKnee;
    compressor.ratio.value = cfg.compRatio;
    compressor.attack.value = cfg.compAttack;
    compressor.release.value = cfg.compRelease;

    var agcGain = ctx.createGain();
    agcGain.gain.value = 1;

    var limiter = ctx.createWaveShaper();
    function makeLimiterCurve(threshold) {
      var n = 2048;
      var curve = new Float32Array(n);
      var t = Math.max(0.1, Math.min(0.99, threshold));
      for (var i = 0; i < n; i++) {
        var x = (i * 2) / (n - 1) - 1;
        var ax = Math.abs(x);
        if (ax <= t) {
          curve[i] = x;
        } else {
          var excess = ax - t;
          var soft = t + excess / (1 + excess * 4);
          curve[i] = (x < 0 ? -1 : 1) * Math.min(0.98, soft);
        }
      }
      return curve;
    }
    limiter.curve = makeLimiterCurve(cfg.limiterThreshold);
    limiter.oversample = "2x";

    var meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    meter.smoothingTimeConstant = 0.55;
    var meterData = new Uint8Array(meter.fftSize);

    var smoothGain = 1;
    var enabled = true;
    var rafId = 0;
    var connected = false;

    function readRms() {
      meter.getByteTimeDomainData(meterData);
      var sum = 0;
      var n = meterData.length;
      for (var i = 0; i < n; i++) {
        var v = (meterData[i] - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / n);
    }

    function agcTick() {
      rafId = requestAnimationFrame(agcTick);
      if (!enabled || !connected) return;
      if (ctx.state !== "running") return;

      var rms = readRms();
      var desired;
      if (rms < cfg.silenceRms) {
        desired = 1;
      } else {
        desired = cfg.targetRms / rms;
        desired = clamp(desired, cfg.agcMin, cfg.agcMax);
      }
      desired = 1 + (desired - 1) * cfg.wet;
      smoothGain += (desired - smoothGain) * cfg.agcSmooth;
      try {
        agcGain.gain.setTargetAtTime(smoothGain, ctx.currentTime, 0.15);
      } catch (e) {}
    }

    function startAgc() {
      if (rafId) return;
      rafId = requestAnimationFrame(agcTick);
    }

    function stopAgc() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }

    function connectFrom(source, destination) {
      if (!source || !destination || connected) return connected;
      try {
        source.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(compressor);
        compressor.connect(agcGain);
        agcGain.connect(limiter);
        limiter.connect(destination);
        compressor.connect(meter);
        connected = true;
        startAgc();
      } catch (e) {
        connected = false;
        console.warn("AudioEnhancer connectFrom", e);
      }
      return connected;
    }

    function setEnabled(on) {
      enabled = !!on;
      if (!enabled) {
        smoothGain = 1;
        try {
          agcGain.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
        } catch (e) {}
      }
    }

    function setWet(w) {
      cfg.wet = clamp(Number(w) || 0, 0, 1);
    }

    function resetAgc() {
      smoothGain = 1;
      try {
        agcGain.gain.setValueAtTime(1, ctx.currentTime);
      } catch (e) {}
    }

    function updateConfig(partial) {
      if (!partial || typeof partial !== "object") return;
      for (var key in partial) {
        if (Object.prototype.hasOwnProperty.call(partial, key) && key in cfg) {
          cfg[key] = partial[key];
        }
      }
      try {
        if ("highpassHz" in partial) highpass.frequency.value = cfg.highpassHz;
        if ("lowpassHz" in partial) lowpass.frequency.value = cfg.lowpassHz;
        if ("compThreshold" in partial) compressor.threshold.value = cfg.compThreshold;
        if ("compKnee" in partial) compressor.knee.value = cfg.compKnee;
        if ("compRatio" in partial) compressor.ratio.value = cfg.compRatio;
        if ("compAttack" in partial) compressor.attack.value = cfg.compAttack;
        if ("compRelease" in partial) compressor.release.value = cfg.compRelease;
        if ("limiterThreshold" in partial) {
          limiter.curve = makeLimiterCurve(cfg.limiterThreshold);
        }
      } catch (e) {}
    }

    return {
      connectFrom: connectFrom,
      setEnabled: setEnabled,
      setWet: setWet,
      resetAgc: resetAgc,
      updateConfig: updateConfig,
      stop: stopAgc,
      get config() { return cfg; },
      get gain() { return smoothGain; },
      get enabled() { return enabled; },
    };
  }

  global.createAudioEnhancer = createAudioEnhancer;
  global.AudioEnhanceDefaults = DEFAULTS;
})(typeof window !== "undefined" ? window : this);
