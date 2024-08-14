function createRender2(options) {
  const Text = Symbol()
  const Comment = Symbol()
  const Fragment = Symbol()
  const { setElementContent } = options
  function unmount(vnode) {
    const el = vnode.el
    el.removeChildren()
  }
  function render2(vnode, container) {
    const oldVnode = container._vnode
    if (vnode) {
      patch2(oldVnode, vnode, container)
    } else {
      // 不存在vnode
      unmount(oldVnode)
    }
  }
  function patch2(oldVnode, newVnode, container) {
    // 相对比新旧节点的type是否相同
    if (oldVnode && oldVnode.type !== newVnode.type) {
      // 需要卸载旧节点,等会把新节点挂载到container,因为container是同一个
      unmount(oldVnode)
      oldVnode = null
    }
    const type = newVnode.type
    if (typeof type === 'string') {
      // html元素节点
      if (!oldVnode) {
        // 旧节点不存在或与新节点类型不同,需要挂载
        mountElement(newVnode, container)
      } else {
        // 旧节点存在,更新属性,新旧节点都存在,说明不需要卸载,那就不需要container
        // 了,只需要专心处理props和children即可(而children的更新需要递归调用
        // patch处理,因为不知道children的状态如何,可能需要卸载也可能需要挂载也可能需要更新),而patchElement中的el是虚拟节
        // 点自身的真实dom节点,不是自己的容器,而是子节点的容器(不要搞混了)
        patchElement(oldVnode, newVnode)
      }
    } else if (type === Text) {
      // 文本节点
    } else if (type === Comment) {
      // 注释节点
    } else if (type === Fragment) {
      // 不需要patchElement,因为Fragment没有el也就没有props属性,所以只需要对子节
      // 点逐一调用patchChildren即可,只有有真实节点的html元素才需要需要修改
      // props,而fragment没有props所以不需要对fragment调用patchElement,fragment
      // 的子节点的父节点是fragment的父节点,所以调用patchChildren时需要传入fragment的container
    }
  }
  function mountElement(vnode, container) {
    const el = (vnode.el = document.createElement(vnode.tag))
    if (el.props) {
      // 设置props
    }
    inertElement(vnode, container, null)
  }
  function patchElement(oldVnode, newVnode) {
    const el = (newVnode.el = oldVnode.el)
    for (let i = 0; i < newVnode.props; i++) {
      const key = newVnode.props[i]
      patchProps(el, key, oldVnode.props[key], newVnode.props[key])
    }
    for (let i = 0; i < oldVnode.props.length; i++) {
      const key = oldVnode.props[i]
      if (!newVnode.props.hasOwnProperty(key)) {
        patchProps(el, key, oldVnode.props[key], null)
      }
    }
    patchChildren(oldVnode, newVnode, el) // 处理子节点,子节点可能需要卸载或者更新,所以需要把container传进来
  }
  function patchProps(el, key, prevValue, nextValue) {
    function shouldSetAsProps(el, key) {
      if (key === 'form' || el.tagName === 'INPUT') {
        return false
      }
      return key in el
    }
    if (/^on/.test(key)) {
      // 事件
      const eventName = key.slice(2).toLowerCase()
      const invokers = el.vel || (el.vel = {}) /* 当前元素绑定的所有的事件处理函数 */
      const invoker = invokers[eventName] /* 事件处理函数 */
      if (nextValue) {
        // 存在新值,需要绑定事件
        if (!invoker) {
          // 第一次绑定当前事件(比如第一次绑定click事件)
          invoker.value = invokers[eventName] = function (e) {
            if (e.timeStamp < invoker.attached) {
              return
            }
            if (Array.isArray(invoker.value)) {
              invoker.value.forEach((fu) => fu(e))
            } else {
              invoker.value(e)
            }
          }
          invoker.attached = performance.now()
          invoker.value = nextValue /* 真正的事件处理函数(用户传入的) */
          el.addEventListener(eventName, invoker.value)
        } else {
          // 已经绑定过当前事件,需要更新事件处理函数
          invoker.value = nextValue
        }
      } else {
        // 不存在新值,需要解绑事件
        el.removeEventLister(eventName, invoker)
      }
    } else if (key === 'class') {
    } else if (key === 'style') {
    } else if (shouldSetAsProps(el, key)) {
      const type = typeof el[key]
      if (type === 'boolean' && nextValue === '') {
        el[key] = true
      } else {
        el[key] = nextValue
      }
    } else {
      el.setAttribute(key, nextValue)
    }
  }
  function patchChildren(oldVnode, newVnode, container) {
    if (typeof newVnode.children === 'string') {
      // 新的子节点是文本节点
      if (Array.isArray(oldVnode.children)) {
        // 旧节点是数组需要卸载逐一旧节点
        oldVnode.children.forEach((child) => {
          unmount(child)
        })
      } else {
        // 旧节点是文本节点或null
        setElementContent(container, newVnode.children)
      }
    } else if (Array.isArray(newVnode.children)) {
      // 新节点是数组
      if (Array.isArray(oldVnode.children)) {
        // 旧节点也是数组,diff算法
      } else {
        // 旧节点是文本节点或null,只需要清空然后逐一挂载新节点(递归调用patch2,因为子节点的状态不可知)
        setElementContent(container, '')
        newVnode.children.forEach((child) => patch2(null, child, container))
      }
    }
  }
  function inertElement(vnode, container, anchor) {
    container.before(vnode.el, anchor)
  }
  return render2
}

const render2 = createRender2({})
