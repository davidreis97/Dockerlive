export class PerformanceGraphs {
	cpuPercentages: Array<number>;
	memoryUsages: Array<number>;
	maxMemory: number;
	nextDataIsFromNewContainer: boolean;

	constructor() {
		let historySize = 50; //Number of points in the graph

		this.cpuPercentages = new Array(historySize);
		this.memoryUsages = new Array(historySize);
		this.maxMemory = 0;

		this.clearGraphs();
	}

	update(data) {
		if(this.nextDataIsFromNewContainer){ //Clear the previous data when a new container starts running but leave the data intact when the container stops without a new one coming in
			this.clearGraphs();
		}

		if (!data.running) {
			this.nextDataIsFromNewContainer = true;
		} else {
			this.nextDataIsFromNewContainer = false;

			this.cpuPercentages.shift();
			this.cpuPercentages.push(data.cpu.percentage);

			this.maxMemory = data.memory.limit;
			this.memoryUsages.shift();
			this.memoryUsages.push(data.memory.usage);
		}

		return {
			cpu: this.cpuPercentages,
			memory: {
				usage: this.memoryUsages,
				limit: this.maxMemory
			}
		}
	}

	clearGraphs() {
		this.cpuPercentages.fill(0);
		this.memoryUsages.fill(0);
		this.maxMemory = 0;
	}

	getHTML() { //! Would be best if the Chart.js dependency was local stored instead of CDN delivered
		return /*html*/`
			<!DOCTYPE html>
			<html lang="en">
			
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Dockerlive</title>
			</head>

			<style type="text/css">
				div#cpuDiv, div#memoryDiv{
					width:100%;
					height:200px;
				}
			</style>
			
			<body>
				<div id="cpuDiv">
					<canvas id="cpu"></canvas>					
				</div>
				
				<div id="memoryDiv">
					<canvas id="memory"></canvas>
				</div>
			
				<script src="https://cdn.jsdelivr.net/npm/chart.js@2.9.3/dist/Chart.min.js"></script>
				<script>
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
										userCallback: function(item, index) {
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
										userCallback: function(item, index) {
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
										suggestedMax: 10,
										maxTicksLimit: 7,
										userCallback: function(item, index) {
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
										userCallback: function(item, index) {
											if (!(item % 5)) return item;
										}
									}
								}]
							}
						}
					});

					window.addEventListener('message', event => {
						const message = event.data;
						
						if(cpuChart.data.labels.length == 0){
							cpuChart.data.labels = message.cpu.map((_val,index,_arr) => message.cpu.length - index);
						}
						cpuChart.data.datasets[0].data = message.cpu;
						cpuChart.update(0);

						if(memoryChart.data.labels.length == 0){
							memoryChart.data.labels = message.memory.usage.map((_val,index,_arr) => message.memory.usage.length - index);
						}
						memoryChart.data.datasets[0].data = message.memory.usage;
						//memoryChart.options.scales.yAxes[0].ticks.suggestedMax = message.memory.limit;

						memoryChart.update(0);
					});

					function getColor(attribute){
						switch(attribute){
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
				</script>
			</body>
			
			</html>
		`;
	}
}