let data = [{"id":"fa4b5b9a709a811f38e10545ee1eddc93c20d7159733783fb699ef1a4d047a6f","fs":[{"a":{"type":"directory","size":0,"permissions":16877,"uid":0,"gid":0,"children":{"b":{"type":"directory","size":0,"permissions":16877,"uid":0,"gid":0,"children":{"c":{"type":"directory","size":0,"permissions":16877,"uid":0,"gid":0,"children":{}}}}}}},{"a":{"type":"directory","size":0,"permissions":16877,"uid":0,"gid":0,"children":{"b":{"type":"directory","size":0,"permissions":16877,"uid":0,"gid":0,"children":{"c":{"type":"directory","size":0,"permissions":16877,"uid":0,"gid":0,"children":{"package.json":{"type":"removal","size":0,"permissions":384,"uid":0,"gid":0,"children":{}}}}}}}}}]}];

let layerDropdown = document.getElementById("layers");
let firstLayerId;
let root;
for (let layer of data){
	if (firstLayerId == null){
    	firstLayerId = layer.id;
    }
	let option = document.createElement("option");
    option.value = layer.id;
    option.innerHTML = layer.id;
    layerDropdown.appendChild(option);
}

function setDisplayedLayer(layerid){
	for (let layer of data){
    	if(layer.id == layerid){
        	root = layer.fs[1];
        	showEntries("/");
        }
    }
}

setDisplayedLayer(firstLayerId);

function createEntry(filepath, filename, entry, depth){
	let tr = document.createElement('tr');
    tr.id = filepath;
    tr.onclick = (_e) => {showEntries(filepath)}
	let type = document.createElement('td');
	type.innerText = entry.type;
	let size = document.createElement('td');
	size.innerText = entry.size;
	let permissions = document.createElement('td');
	permissions.innerText = entry.permissions;
	let name = document.createElement('td');
    let nameDepth = ""
   	while(depth--){
    	nameDepth += "│";
    }
	name.innerText = nameDepth + filename;//!- TODO
	tr.appendChild(type);
    tr.appendChild(size);
    tr.appendChild(permissions);
    tr.appendChild(name);
	return tr;
}

function isSubpath(rootPath,edgePath){
	rootPathSplit = rootPath.split("/");
    edgePathSplit = edgePath.split("/");
    
    for(let [index,rootSegment] of rootPathSplit.entries()){
    	if(edgePathSplit[index] == null || rootSegment != edgePathSplit[index]){
        	return false;
        }
    }
    
    return true;
}

function hideEntries(parentPath){
	let parentElement = document.getElementById(parentPath);
    parentElement.onclick = (_e) => {showEntries(parentPath)}
    let currentElement = parentElement.nextSibling;
    let filetable = document.getElementById("filetable");
    
    while(currentElement != null){
    	if(!isSubpath(parentPath,currentElement.id)){
        	break;
        }
        
        let nextElement = currentElement.nextSibling;
        currentElement.parentNode.removeChild(currentElement);
        currentElement = nextElement;
    }
}

function showEntries(parentPath){
	let [parentNode,depth] = navigateToPath(parentPath);
    let previousElement = document.getElementById(parentPath);
    let addNode;
    
    if (previousElement){
    	previousElement.onclick = (_e) => {hideEntries(parentPath)}
    	addNode = (node) => {
        	previousElement.parentNode.insertBefore(node, previousElement.nextSibling);
        }
    }else{
    	addNode = (node) => {
        	let parentElement = document.getElementById("filetable");
            parentElement.appendChild(node);
        }
    }
    	
    let newEntries = [];
    for(let [filename,entry] of Object.entries(parentNode)){
    	addNode(createEntry(parentPath + "/" + filename, filename, entry, depth));
    }
    //highlightChanges();
}

function navigateToPath(path){
	let splitPath = path.split("/").filter((value,_index_arr) => value && value.length > 0);
    let currentNode = root;
    let depth = 0;
    
    while(splitPath.length > 0){
    	depth++;
    	currentNode = currentNode[splitPath.shift()].children;
    }
    
    return [currentNode,depth];
}