export class PerformanceGraphs{
	cpuPercentages : Array<number>
	memoryUsages : Array<number>
	running : boolean;

	constructor(){
		let historySize = 50; //Number of points in the graph

		this.cpuPercentages = new Array(historySize);
		this.memoryUsages = new Array(historySize);

		this.clearGraphs();
	}

	update(data){
		if (data == "CLEAR"){
			this.clearGraphs();
		}else{
			this.running = true;
		}
	}

	clearGraphs(){
		this.cpuPercentages.fill(0);
		this.memoryUsages.fill(0);

		this.running = false;
	}

	getHTML(){return `
		
	`;};
}