import { DynamicAnalysis } from './dynamicAnalysis';
import { Stream } from 'stream';

//Based on https://github.com/moby/moby/blob/eb131c5383db8cac633919f82abad86c99bffbe5/cli/command/container/stats_helpers.go#L175-L188
function calculateCPUPercent(stats) {
	try {
		let cpuPercent = 0;
		let cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
		let systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
		let cpuCount = stats.cpu_stats.cpu_usage.percpu_usage.length;

		if (systemDelta && cpuDelta) {
			cpuPercent = (cpuDelta / systemDelta) * cpuCount * 100;
		}

		return !isNaN(cpuPercent) ? cpuPercent : 0;
	} catch (e) {
		return 0;
	}
}

function calculateNetworks(stats) {
	let rawNetworks = stats.networks;
	let finalNetworks = {};

	try {
		for (let key of Object.keys(rawNetworks)) {
			finalNetworks[key] = {
				input: rawNetworks[key].rx_bytes,
				output: rawNetworks[key].tx_bytes
			};
		}

		return finalNetworks;
	} catch (e) {
		return {};
	}
}

//Based on https://github.com/moby/moby/blob/eb131c5383db8cac633919f82abad86c99bffbe5/cli/command/container/stats_helpers.go#L106-L125
function calculateStorage(stats) {
	let readBytes = 0;
	let writeBytes = 0;

	try {
		if (process.platform === "win32") {
			readBytes = stats.storage_stats.read_size_bytes || 0;
			writeBytes = stats.storage_stats.write_size_bytes || 0;
		} else {
			for (let entry of stats.blkio_stats.io_service_bytes_recursive) {
				if (entry.op == "read") {
					readBytes += entry.value;
				} else if (entry.op == "write") {
					writeBytes += entry.value;
				}
			}
		}

		return {
			readBytes: !isNaN(readBytes) ? readBytes : 0,
			writeBytes: !isNaN(writeBytes) ? writeBytes : 0
		};
	} catch (e) {
		return {
			readBytes: 0,
			writeBytes: 0
		};
	}
}

export function getPerformance(this: DynamicAnalysis) {
	if (this.isDestroyed) {
		return;
	}

	this.container.stats((err, stream: Stream) => {
		if (this.isDestroyed) {
			return;
		}

		if (err) {
			this.debugLog("ERROR GETTING CONTAINER STATS", err);
			return;
		}

		stream.on('data', (data: Buffer) => {
			if (this.isDestroyed) {
				return;
			}
			let parsedData = JSON.parse(data.toString());

			if (JSON.stringify(parsedData.memory_stats) === "{}") {
				return;
			}

			this.sendPerformanceStats({
				running: true,
				cpu: {
					percentage: calculateCPUPercent(parsedData)
				},
				memory: {
					usage: parsedData.memory_stats.usage || 0,
					limit: parsedData.memory_stats.limit || 0
				},
				networks: calculateNetworks(parsedData),
				storage: calculateStorage(parsedData)
			});
		});

		stream.on('end', () => {
			this.sendPerformanceStats({
				running: false
			});
		});
	});
}