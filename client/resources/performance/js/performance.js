let darkMode = (document.getElementsByClassName("vscode-dark").length > 0);

let cpuCanvas = document.getElementById('cpu').getContext('2d');
let cpuChart = new Chart(cpuCanvas, {
	type: 'line',
	data: {
		labels: [],
		datasets: [{
			label: 'CPU (%)',
			data: [],
			backgroundColor: 'rgba(255, 99, 132, 0.2)',
			borderColor: 'rgba(255, 99, 132, 1)',
		}]
	},
	options: {
		responsive: true,
		maintainAspectRatio: false,
		legend: {
			labels: {
				fontColor: getColor("text"),
				fontSize: 18
			}
		},
		tooltips: {
			enabled: false
		},
		scales: {
			yAxes: [{
				gridLines: {
					color: getColor("gridLines"),
				},
				ticks: {
					fontColor: getColor("text"),
					suggestedMin: 0,
					suggestedMax: 100,
					userCallback: function (item, index) {
						if (!(item % 20)) return item;
					}
				},
			}],
			xAxes: [{
				scaleLabel: {
					fontColor: getColor("text"),
					display: true,
					labelString: "Time elapsed (s)"
				},
				gridLines: {
					display: false,
				},
				ticks: {
					fontColor: getColor("text"),
					maxRotation: 0,
					userCallback: function (item, index) {
						if (!(item % 5)) return item;
					}
				}
			}]
		}
	}
});

let memoryCanvas = document.getElementById('memory').getContext('2d');
let memoryChart = new Chart(memoryCanvas, {
	type: 'line',
	data: {
		labels: [],
		datasets: [{
			label: 'Memory (MB)',
			data: [],
			backgroundColor: 'rgba(99, 255, 132, 0.2)',
			borderColor: 'rgba(99, 255, 132, 1)',
		}]
	},
	options: {
		responsive: true,
		maintainAspectRatio: false,
		legend: {
			labels: {
				fontColor: getColor("text"),
				fontSize: 16
			}
		},
		tooltips: {
			enabled: false
		},
		scales: {
			yAxes: [{
				gridLines: {
					color: getColor("gridLines"),
				},
				ticks: {
					fontColor: getColor("text"),
					suggestedMin: 0,
					suggestedMax: 10000,
					maxTicksLimit: 7,
					userCallback: function (item, index) {
						return item / 1000000;
					}
				},
			}],
			xAxes: [{
				scaleLabel: {
					fontColor: getColor("text"),
					display: true,
					labelString: "Time elapsed (s)"
				},
				gridLines: {
					display: false,
				},
				ticks: {
					fontColor: getColor("text"),
					maxRotation: 0,
					userCallback: function (item, index) {
						if (!(item % 5)) return item;
					}
				}
			}]
		}
	}
});

let storageCanvas = document.getElementById('storage').getContext('2d');
let storageChart = new Chart(storageCanvas, {
	type: 'line',
	data: {
		labels: [],
		datasets: [{
			label: 'Storage Read (MB)',
			data: [],
			backgroundColor: 'rgba(132, 255, 99, 0.2)',
			borderColor: 'rgba(132, 255, 99, 1)',
		},
		{
			label: 'Storage Write (MB)',
			data: [],
			backgroundColor: 'rgba(132, 99, 255, 0.2)',
			borderColor: 'rgba(132, 99, 255, 1)',
		}]
	},
	options: {
		responsive: true,
		maintainAspectRatio: false,
		legend: {
			labels: {
				fontColor: getColor("text"),
				fontSize: 16
			}
		},
		tooltips: {
			enabled: false
		},
		scales: {
			yAxes: [{
				gridLines: {
					color: getColor("gridLines"),
				},
				ticks: {
					fontColor: getColor("text"),
					suggestedMin: 0,
					suggestedMax: 10000,
					maxTicksLimit: 7,
					userCallback: function (item, index) {
						return item / 1000000;
					}
				},
			}],
			xAxes: [{
				scaleLabel: {
					fontColor: getColor("text"),
					display: true,
					labelString: "Time elapsed (s)"
				},
				gridLines: {
					display: false,
				},
				ticks: {
					fontColor: getColor("text"),
					maxRotation: 0,
					userCallback: function (item, index) {
						if (!(item % 5)) return item;
					}
				}
			}]
		}
	}
});

let networkCharts = {};

window.addEventListener('message', event => {
	const message = event.data;

	if (cpuChart.data.labels.length == 0) {
		cpuChart.data.labels = message.cpu.map((_val, index, _arr) => message.cpu.length - index);
	}
	cpuChart.data.datasets[0].data = message.cpu;
	cpuChart.update(0);

	if (memoryChart.data.labels.length == 0) {
		memoryChart.data.labels = message.memory.usage.map((_val, index, _arr) => message.memory.usage.length - index);
	}
	memoryChart.data.datasets[0].data = message.memory.usage;
	//memoryChart.options.scales.yAxes[0].ticks.suggestedMax = message.memory.limit;

	memoryChart.update(0);

	for (interfaceName of Object.keys(message.networks)) {
		if (!document.getElementById(interfaceName)) {
			let networks = document.getElementById("networks");
			let networkDiv = document.createElement("div");
			networkDiv.className = "networkDiv";
			let networkCanvas = document.createElement("canvas");
			networkCanvas.id = interfaceName;
			networkDiv.appendChild(networkCanvas);
			networks.appendChild(networkDiv);

			networkCharts[interfaceName] = new Chart(networkCanvas, {
				type: 'line',
				data: {
					labels: [],
					datasets: [{
						label: 'Network Input - ' + interfaceName + ' (MB)',
						data: [],
						backgroundColor: 'rgba(99, 132, 255, 0.2)',
						borderColor: 'rgba(99, 132, 255, 1)',
					},
					{
						label: 'Network Output - ' + interfaceName + ' (MB)',
						data: [],
						backgroundColor: 'rgba(255, 132, 99, 0.2)',
						borderColor: 'rgba(255, 132, 99, 1)',
					}]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					legend: {
						labels: {
							fontColor: getColor("text"),
							fontSize: 16
						}
					},
					tooltips: {
						enabled: false
					},
					scales: {
						yAxes: [{
							gridLines: {
								color: getColor("gridLines"),
							},
							ticks: {
								fontColor: getColor("text"),
								suggestedMin: 0,
								suggestedMax: 10000,
								maxTicksLimit: 7,
								userCallback: function (item, index) {
									return item / 1000000;
								}
							},
						}],
						xAxes: [{
							scaleLabel: {
								fontColor: getColor("text"),
								display: true,
								labelString: "Time elapsed (s)"
							},
							gridLines: {
								display: false,
							},
							ticks: {
								fontColor: getColor("text"),
								maxRotation: 0,
								userCallback: function (item, index) {
									if (!(item % 5)) return item;
								}
							}
						}]
					}
				}
			});
		}

		if (networkCharts[interfaceName].data.labels.length == 0) {
			networkCharts[interfaceName].data.labels = message.networks[interfaceName].input.map((_val, index, _arr) => message.networks[interfaceName].input.length - index);
		}
		networkCharts[interfaceName].data.datasets[0].data = message.networks[interfaceName].input;
		networkCharts[interfaceName].data.datasets[1].data = message.networks[interfaceName].output;
		networkCharts[interfaceName].update(0);
	}

	for (let interfaceName of Object.keys(networkCharts)) {
		if (!message.networks.hasOwnProperty(interfaceName) && networkCharts[interfaceName] != null) {
			networkCharts[interfaceName] = null;

			let canvas = document.getElementById(interfaceName);
			canvas.parentNode.parentNode.removeChild(canvas.parentNode); //Remove the parent div of the canvas
		}
	}

	if (storageChart.data.labels.length == 0) {
		storageChart.data.labels = message.storage.readBytes.map((_val, index, _arr) => message.storage.readBytes.length - index);
	}
	storageChart.data.datasets[0].data = message.storage.readBytes;
	storageChart.data.datasets[1].data = message.storage.writeBytes;
	storageChart.update(0);
});

function getColor(attribute) {
	switch (attribute) {
		case "gridLines":
			return darkMode ? 'rgba(200, 200, 200, 0.4)' : 'rgba(30, 30, 30, 0.4)';
			break;
		case "text":
			return darkMode ? 'rgba(244, 244, 244, 1)' : 'rgba(20, 20, 20, 1)';
			break;
		default:
			console.error("Unknown color attribute: [" + attribute + "]");
			break;
	}
}

const vscode = acquireVsCodeApi();

function stop() {
	vscode.postMessage({
		command: 'stop'
	});
}

function restartContainer() {
	vscode.postMessage({
		command: 'restartContainer'
	});
}

function restartBuild() {
	vscode.postMessage({
		command: 'restartBuild'
	});
}

function openShell() {
	vscode.postMessage({
		command: 'openShell'
	});
}