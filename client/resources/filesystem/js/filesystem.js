let data = [];

let layerDropdown = document.getElementById("layers");
let upLayerButton = document.getElementById("upLayerButton");
let downLayerButton = document.getElementById("downLayerButton");
let firstLayerId;
let root;

let openFolders = ['/'];

function setDisplayedLayer(layerid){
    hideEntries('/',false);
	for (let layer of data){
    	if(layer.id == layerid){
        	root = layer.fs[0];
        	for(let folder of openFolders){
                showEntries(folder);
            }
        }
    }
}

function updateButtons(){
    if(layerDropdown.selectedIndex <= 0){
        upLayerButton.setAttribute("disabled", "");
    }else{
        upLayerButton.removeAttribute("disabled")
    }

    if(layerDropdown.selectedIndex + 1 >= data.length){
        downLayerButton.setAttribute("disabled", "");
    }else{
        downLayerButton.removeAttribute("disabled");
    }
}

function upLayer(){
    layerDropdown.selectedIndex--;
    updateButtons();
    layerDropdown.dispatchEvent(new Event("change"));
}

function downLayer(){
    layerDropdown.selectedIndex++;
    updateButtons();
    layerDropdown.dispatchEvent(new Event("change"));
}

window.addEventListener('message', event => {
    update(event.data);
});

function update(newData){
    data = newData;
    for (let layer of data){
        if (firstLayerId == null){
            firstLayerId = layer.id;
        }
        let option = document.createElement("option");
        option.value = layer.id;
        option.innerHTML = layer.id;
        layerDropdown.appendChild(option);
    }
    
    updateButtons();

    setDisplayedLayer(firstLayerId);
}

function createEntry(filepath, filename, entry, depth, childrenCount){
	let tr = document.createElement('tr');
    tr.id = filepath;
	let type = document.createElement('td');
	type.innerText = entry.type;
	let size = document.createElement('td');
	size.innerText = processSize(entry.size);
	let permissions = document.createElement('td');
	permissions.innerText = entry.permissions;
	let name = document.createElement('td');
    let nameDepth = ""
   	while(depth--){
    	nameDepth += " │ ";
    }
    if(entry.type == "directory"){
        tr.onclick = (_e) => {showEntries(filepath)}
        tr.classList.add("clickable");
        size.innerText = childrenCount + " files"
    }
	name.innerText = nameDepth + filename;
	tr.appendChild(type);
    tr.appendChild(size);
    tr.appendChild(permissions);
    tr.appendChild(name);
	return tr;
}

function isSubpath(rootPath,edgePath){
	rootPathSplit = rootPath.split("/").filter((value,_index_arr) => value && value.length > 0);
    edgePathSplit = edgePath.split("/").filter((value,_index_arr) => value && value.length > 0);
    
    for(let [index,rootSegment] of rootPathSplit.entries()){
    	if(edgePathSplit[index] == null || rootSegment != edgePathSplit[index]){
        	return false;
        }
    }
    
    return true;
}

function hideEntries(parentPath, registerOpenFolders = true){
    let currentElement;
    
    if(isSubpath(parentPath,"/")){
        currentElement = document.getElementById("filetable").getElementsByTagName("tr")[1];
    }else{
        let parentElement = document.getElementById(parentPath);
        parentElement.onclick = (_e) => {showEntries(parentPath)};
        currentElement = parentElement.nextSibling;
    }
    
    while(currentElement != null){
    	if(!isSubpath(parentPath,currentElement.id)){
        	break;
        }
        
        let nextElement = currentElement.nextSibling;
        currentElement.parentNode.removeChild(currentElement);
        currentElement = nextElement;
    }

    if(registerOpenFolders){
        openFolders = openFolders.filter((folder,_index,_arr) => !(folder == parentPath || isSubpath(parentPath,folder)));
    }
}

function showEntries(parentPath, registerOpenFolders = true){
    let [parentNode,depth] = navigateToPath(parentPath);
    if(parentNode == null || depth == null){
        return;
    }
    let previousElement = document.getElementById(parentPath);
    let addNode;
    
    if (previousElement){
    	previousElement.onclick = (_e) => {hideEntries(parentPath)}
    	addNode = (node) => {
            previousElement.parentNode.insertBefore(node, previousElement.nextSibling);
            previousElement = previousElement.nextSibling;
        }
    }else{
    	addNode = (node) => {
        	let parentElement = document.getElementById("filetable");
            parentElement.appendChild(node);
        }
    }
    	
    for(let [filename,entry] of Object.entries(parentNode)){
        let childrenCount = Object.entries(entry.children).length;
    	addNode(createEntry(parentPath + "/" + filename, filename, entry, depth, childrenCount));
    }

    if (registerOpenFolders && !openFolders.includes(parentPath)) 
        openFolders.push(parentPath);
    
    //highlightChanges();
}

function navigateToPath(path){
	let splitPath = path.split("/").filter((value,_index_arr) => value && value.length > 0);
    let currentNode = root;
    let depth = 0;
    
    while(splitPath.length > 0){
    	depth++;
        currentNode = currentNode[splitPath.shift()]
        if(!currentNode){
            return [null,null];
        }
        currentNode = currentNode.children;
    }
    
    return [currentNode,depth];
}

function processSize(size){
    let unit = "B";
    if (size > 1000000000) {
        unit = "GB";
        size /= 1000000000;
    } else if (size > 1000000) {
        unit = "MB";
        size /= 1000000;
    } else if (size > 1000) {
        unit = "KB";
        size /= 1000;
    }

    return size.toFixed(2) + unit;
}