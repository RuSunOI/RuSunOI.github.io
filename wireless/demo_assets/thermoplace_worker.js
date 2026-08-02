/* ThermoPlace-P paper solver worker. All numerical work runs in C++/WASM. */
importScripts("./thermoplace_wasm.js");

let modulePromise = null;

function loadModule() {
  if (!modulePromise) {
    modulePromise = createThermoPlaceModule({
      locateFile(path) {
        return new URL(path, self.location.href).href;
      },
      onProgress(iteration, total, bestCost) {
        self.postMessage({ type: "progress", iteration, total, bestCost });
      }
    });
  }
  return modulePromise;
}

self.onmessage = async event => {
  const message = event.data || {};
  if (message.type === "init") {
    try {
      await loadModule();
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({ type: "error", message: `WASM 初始化失败：${error?.message || error}` });
    }
    return;
  }

  if (message.type !== "solve" && message.type !== "evaluate") return;
  try {
    const module = await loadModule();
    const config = Float64Array.from(message.config || []);
    for (let index = 0; index < config.length; index += 1) {
      if (module._set_config_value(index, config[index]) !== 0) throw new Error(`配置槽 ${index} 写入失败`);
    }
    const code = message.type === "evaluate"
      ? module._evaluate_layout_buffered(message.algorithm, message.seed, message.legalize ? 1 : 0)
      : module._solve_paper_buffered(message.algorithm, message.seed);
    if (code !== 0) throw new Error(module.UTF8ToString(module._last_error_ptr()) || `求解器返回错误 ${code}`);
    const result = JSON.parse(module.UTF8ToString(module._result_json_ptr()));
    self.postMessage({ type: "result", requestId: message.requestId, operation: message.type, result });
  } catch (error) {
    self.postMessage({ type: "error", requestId: message.requestId, message: error?.message || String(error) });
  }
};

loadModule().then(() => self.postMessage({ type: "ready" })).catch(error => {
  self.postMessage({ type: "error", message: `WASM 初始化失败：${error?.message || error}` });
});
