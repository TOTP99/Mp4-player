/**
 * audio-enhance.js —— 视频 / 影音音质与响度处理（独立模块）
 *
 * 针对 mp4 对白 + 音效 + 背景声优化（相对纯音乐版更稳、更少放大底噪）：
 * 1) 高通去隆隆 / 交流声 + 轻柔低通削刺耳高频
 * 2) 压缩器压峰值
 * 3) AGC 自动响度平衡（静音检测 + 增益钳位 + 平滑）
 * 4) 软限幅防爆音（比音乐版多一层保护）
 *
 * 用法：
 *   const enh = createAudioEnhancer(audioContext);
 *   enh.connectFrom(mediaElementSource, destination); // destination 通常是 ctx.destination
 *   // 切歌 / 换片后可 enh.resetAgc()
 *   // enh.setEnabled(false) 或 setWet(0) 旁路
 *
 * 可调参数见 DEFAULTS。
 */
(function (global) {
  "use strict";

  var DEFAULTS = {
    // 高通：切掉低频隆隆 / 交流声（视频对白略抬一点，减少闷感）
    highpassHz: 85,
    // 低通：略削超高频沙沙声；过大等于没开
    lowpassHz: 14000,
    // 压缩：压住突然很大的段落（对白+爆炸声场景）
    compThreshold: -24,
    compKnee: 12,
    compRatio: 3.2,
    compAttack: 0.008,
    compRelease: 0.25,
    // AGC：目标 RMS（时间域 0~1 近似），越大整体越响
    targetRms: 0.10,
    // AGC 增益钳位，避免静音段被猛拉、爆音段被压没
    agcMin: 0.5,
    agcMax: 2.0,
    // 低于此 RMS 视为近静音，不再往上猛推（防放大底噪）
    silenceRms: 0.012,
    // AGC 平滑速度 0~1，越大跟得越快（视频稍慢一点更自然）
    agcSmooth: 0.045,
    // 总湿声比例（1=全开增强，0=等于直通增益 1）
    wet: 1,
    // 软限幅：AGC 之后再压一次，防止偶发削波（0.92≈-0.7dB）
    limiterThreshold: 0.92,
  };

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /**
   * @param {AudioContext} ctx
   * @param {object} [opts] 覆盖 DEFAULTS
   */
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

    // 软限幅：用 WaveShaper 做轻柔限幅，比单纯增益更安全
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
          // 软拐点：超出部分缓慢压回
          var excess = ax - t;
          var soft = t + excess / (1 + excess * 4);
          curve[i] = (x < 0 ? -1 : 1) * Math.min(0.98, soft);
        }
      }
      return curve;
    }
    limiter.curve = makeLimiterCurve(cfg.limiterThreshold);
    limiter.oversample = "2x";

    // 在压缩后取样，用于 AGC（不送扬声器）
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
        // 近静音：缓慢回到 1，避免把底噪抬成沙沙声
        desired = 1;
      } else {
        desired = cfg.targetRms / rms;
        desired = clamp(desired, cfg.agcMin, cfg.agcMax);
      }
      // 湿声比例：wet=0 时等价增益 1
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

    /**
     * 将 mediaElementSource 接到增强链，再输出到 destination（通常 ctx.destination）
     * source 仍可另外 connect 到频谱 analyser（若需要）
     */
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

    /** 切歌 / 换片后可调用，避免沿用上一首的 AGC 增益 */
    function resetAgc() {
      smoothGain = 1;
      try {
        agcGain.gain.setValueAtTime(1, ctx.currentTime);
      } catch (e) {}
    }

    /** 运行时微调参数（部分立即生效） */
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
      get config() {
        return cfg;
      },
      get gain() {
        return smoothGain;
      },
      get enabled() {
        return enabled;
      },
    };
  }

  global.createAudioEnhancer = createAudioEnhancer;
  global.AudioEnhanceDefaults = DEFAULTS;
})(typeof window !== "undefined" ? window : this);
