
export class FilesystemVisualizer {
	getHTML(css,js) {
		return /*html*/`
			<!DOCTYPE html>
			<html lang="en">
			
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link rel="stylesheet" type="text/css" href="${css}" />

				<title>Filesystem</title>
			</head>

			<body>
			<div class="table-wrapper">
				<div class="layerPicker">
					<p id="layerLabel">Layer ID:</p>
					<select id="layers" name="layers" onchange="setDisplayedLayer(this.value)">
					</select>
					<button id="upLayerButton" onclick="upLayer()">Up</button>
					<button id="downLayerButton" onclick="downLayer()">Down</button>
				</div>
				<table id="filetable">
					<col width="10">
					<col width="80">
					<col width="80">
					<col width="80">
					<tr>
						<th align="left">C</th>
						<th align="left">Type</th>
						<th align="left">Size</th>
						<th align="left">Mode</th>
						<th align="left">Name</th>
					</tr>
				</table>
			</div>

			<script src="${js}"> </script>
			</body>

			</html>
		`;
	}
}