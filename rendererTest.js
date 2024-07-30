function vcomponentFun() {
	return {
		tag: 'h2',
		props: {
			onClick: () => {
				alert('hello world');
			},
		},
		children: '我是vue渲染出来的标题fun',
	};
}

const vcomponentObj = {
	render() {
		return {
			tag: 'h2',
			props: {
				onClick: () => {
					alert('hello world');
				},
			},
			children: '我是vue渲染出来的标题obj',
		};
	},
};

const vnode = {
	tag: vcomponentObj,
};

function renderer(vnode, container) {
	if (typeof vnode.tag === 'string') {
		mountElement(vnode, container);
	} else if (typeof vnode.tag === 'function') {
		mountComponentFun(vnode, container);
	} else if (typeof vnode.tag === 'object') {
		mountComponentObj(vnode, container);
	}
}
function mountElement(vnode, container) {
	const el = document.createElement(vnode.tag);
	for (let key in vnode.props) {
		if (/^on/.test(key)) {
			el.addEventListener(
				key.substring(2).toLowerCase(),
				vnode.props[key]
			);
		}
	}
	if (typeof vnode.children === 'string') {
		el.appendChild(document.createTextNode(vnode.children));
	} else if (Array.isArray(vnode.children)) {
		vnode.children.forEach((v) => {
			renderer(v, el);
		});
	}
	container.appendChild(el);
}
function mountComponentFun(vnode, container) {
	const subtree = vnode.tag();
	renderer(subtree, container);
}
function mountComponentObj(vnode, container) {
	const subtree = vnode.tag.render();
	renderer(subtree, container);
}

renderer(vnode, document.getElementById('app'));
