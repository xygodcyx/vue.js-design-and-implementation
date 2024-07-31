function createRenderer(options) {
  function unmount(vnode) {
    const parent = vnode.el.parentNode
    if (parent) {
      parent.removeChild(vnode.el)
    }
  }
  function render(vnode, container) {
    // 如果存在vnode, 则进行patch操作(挂载或打补丁)
    if (vnode) {
      patch(container._vnode, vnode, container)
    } else {
      // 如果vnode不存在并且container._vnode存在，说明不需要新节点了但存在旧节点，那么此时就是unmount操作
      if (container._vnode) {
        // 拿到真实的dom节点
        unmount(container._vnode)
      }
    }
    container._vnode = vnode
  }
  const { createElement, setElementText, insert, patchProps } = options

  // n1旧 n2新
  function patch(n1, n2, container) {
    if (n1 && n2 && n1.type !== n2.type) {
      // 类型不同，需要卸载旧节点，然后挂载新节点
      unmount(n1)
      n1 = null
    }
    // 运行到这里,说明vnode1和vnode2的类型相同
    const { type } = n2
    if (typeof type === 'string') {
      if (!n1) {
        mountElement(n2, container)
      } else {
        // 打补丁
        console.log('patch')
        patchElement(n1, n2)
      }
    } else if (typeof type === 'object') {
      // 组件
    } else if (typeof type === '??') {
      // 其他
    }
  }
  function patchElement(n1, n2) {}

  function mountElement(vnode, container) {
    const el = (vnode.el = createElement(vnode.type))

    if (typeof vnode.children === 'string') {
      setElementText(el, vnode.children)
    } else if (Array.isArray(vnode.children)) {
      vnode.children.forEach((child) => {
        patch(null, child, el)
      })
    }

    if (vnode.props) {
      for (const key in vnode.props) {
        // 挂载时
        patchProps(el, key, null, vnode.props[key])
      }
    }
    insert(container, el)
  }
  return {
    render,
  }
}

const { render } = createRenderer({
  createElement: (tag) => {
    return document.createElement(tag)
  },
  setElementText: (el, text) => {
    el.textContent = text
  },
  insert(parent, el, anchor = null) {
    parent.appendChild(el)
  },

  patchProps(el, key, prevValue, nextValue) {
    // 有些属性在某些元素上是只读的
    function shouldSetAsProps(el, key, value) {
      if (key === 'form' && el.tagName === 'INPUT') return false
      return key in el
    }
    if (/^on/.test(key)) {
      // 事件绑定
      const eName = key.slice(2).toLowerCase()
      //因为el.vel可能不存在,所以不能写成这样：el.vel[eName]
      // invokers是一个元素绑定的所有事件
      const invokers = el.vel || (el.vel = {})
      let invoker = invokers[eName]
      if (nextValue) {
        // 需要绑定事件
        if (!invoker) {
          // 第一次绑定事件
          invoker = invokers[eName] = function (e) {
            // 传递的事件可以是数组，需要遍历执行
            if (Array.isArray(invoker.value)) {
              invoker.value.forEach((fn) => fn(e))
            } else {
              invoker.value(e)
            }
          }
          invoker.value = nextValue
          el.addEventListener(eName, invoker)
        } else {
          // 已经绑定过事件，需要更新invoker的value
          invoker.value = nextValue
        }
      } else {
        // 解绑事件
        el.removeEventListener(eName, invoker)
      }
    } else if (key === 'class') {
      // 类名绑定
      el.className = normalizeClass(nextValue)
    } else if (key === 'style') {
      el.style = normalizeStyle(nextValue)
    } else if (shouldSetAsProps(el, key, nextValue)) {
      // 属性设置
      // 如果key是DOM Properties属性
      const type = typeof el[key]

      if (type === 'boolean' && nextValue === '') {
        // 修正 el["disabled"] = "" 浏览器会将其设置为false的情况,实际上我们希望为true
        el[key] = true
      } else {
        el[key] = nextValue
      }
    } else {
      el.setAttribute(key, nextValue)
    }
  },
})
const vnode1 = {
  type: 'button2',
  props: {
    id: 'foo',
    disabled: 1,
    class: [
      'foo',
      {
        bar: true,
        baz: true,
      },
    ],
  },
  children: [
    {
      type: 'p',
      children: 'hello',
    },
  ],
}
const vnode2 = {
  type: 'button',
  props: {
    id: 'span',
    class: [
      'name',
      {
        active: true,
      },
    ],
    style: {
      color: '#987212',
      fontSize: '20px',
      backgroundColor: '#123456',
      borderRadius: '5px',
      transform: 'scale(2) rotate(0deg) translateX(40px) translateY(20px)',
      transformOrigin: 'right bottom',
      cursor: 'pointer',
    },
    onClick: [
      () => {
        console.log('click')
      },
      () => {
        console.log('click2')
      },
    ],
    oncontextmenu: (e) => {
      e.preventDefault()
      console.log('contextmenu')
    },
    onmouseenter: () => {
      console.log('mouseenter')
    },
    onmouseleave: () => {
      console.log('mouseleave')
    },
  },
  children: 'span',
}
const vnode3 = {
  type: 'span',
  props: {
    id: 'span',
    class: [
      'name',
      {
        active: true,
      },
    ],
    onClick: null,
  },
  children: 'span',
}
render(vnode1, document.getElementById('app'))
render(vnode2, document.querySelector('#app'))
// render(null, document.getElementById('app'))

// tools
function normalizeClass(value) {
  let res = ''
  function handleStringClassName(value) {
    return value.trim()
  }
  function handleObjClassName(value) {
    let res = ''
    for (let key in value) {
      if (value[key]) {
        res += key + ' '
      }
    }
    return res
  }
  function handleArrClassName(value, _res = '') {
    let res = ''
    for (let i = 0; i < value.length; i++) {
      if (typeof value[i] === 'string') {
        res += handleStringClassName(value[i]) + ' '
      }
      if (Array.isArray(value[i])) {
        res += handleArrClassName(value[i], res)
      } else if (typeof value[i] === 'object') {
        res += handleObjClassName(value[i])
      }
    }
    return res
  }
  if (typeof value === 'string') {
    res += handleStringClassName(value)
  } else if (Array.isArray(value)) {
    res += handleArrClassName(value)
  } else if (typeof value === 'object') {
    res += handleObjClassName(value)
  }
  return res.trim()
}

function normalizeStyle(value) {
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('style must be an object')
  }
  let res = ''
  function camelToKebab(str) {
    return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase()
  }
  function camelStyleToKebab(value) {
    const res = {}
    // 检查是否有浏览器支持的样式属性
    const dom = document.createElement('div')
    for (const key in value) {
      if (key in dom.style) {
        res[camelToKebab(key)] = value[key]
      } else {
        console.warn(`Invalid style property: ${key}`)
      }
    }
    return res
  }

  let styleObj = {}
  styleObj = camelStyleToKebab(value)
  function transformStyleToString(res) {
    let styleStr = ''
    for (const key in res) {
      styleStr += `${key}:${res[key]};`
    }
    return styleStr
  }
  res = transformStyleToString(styleObj)

  return res
}
