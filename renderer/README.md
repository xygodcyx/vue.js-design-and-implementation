---
markdown:
  id: renderer
  path: output.md
---

# 渲染

<p style="display: flex; justify-content: start; gap: 10px;">
  <a href="../README.md">首页</a>
  <a href="../reactivity/README.md">上一页</a>
  <a href="../problems/README.md">下一页</a>
</p>

## 前置知识

  1. **DOM Properties 和 HTML Attributes**

     >HTML Attributes是用来设置与之对应的DOM Properties的默认值的

## render流程

  执行render函数,传入要渲染的虚拟dom节点,然后传入容器(真实节点),然后会先判断dom节点是否存在,如果不存在那就需要卸载,如果不存在那就需要说明需要卸载,那就卸载旧节点,如果存在那就说明需要挂载或更新,我们旧调用patch函数,然后把旧节点(在容器上,因为如果挂载过了,那容器上就有了旧节点,也是虚拟dom)和新节点(传入的虚拟dom节点)和容器传入,在patch函数里，我们会先判断新旧节点的type是否相同,如果不同,那就一定需要先卸载旧节点然后挂载新节点,如果相同,那就先判断是type什么类型,如果是字符串,那就说明是html原生元素,如果是Text(自定义的Symbol值)或Comment(注释节点)或Fragment(不渲染自身只渲染子节点)。如果是原生html元素，那就先判断是否n1（旧节点）是否存在，不存在就卸载，存在就需要更新，更新时（patchElement）会先更新自身属性（props）然后更新子节点，在更新children时会有很多种情况：

  1. 当新children是字符串时，如果旧children是数组，那就需要先逐一卸载（注意，不能直接调用container.innerHTML=""来情况字符串,因为我们需要管理子组件的生命周期）,然后就剩下旧children是文本节点或null的情况了,无论是那种情况,都需要情况旧children然后设置新的字符串即可(先清空container然后再设置container的文本内容为新children)
  2. 当新children是数组时,如果旧children也是数组,那就涉及到核心的diff算法了,暂时按下不表
     当新children是字符串或null时,无论是那种情况,只需要先情况container的文本内容,然后逐一patch新children即可(注意,这里一定是patch,因为我们不知道新children是否还有children,所以需要再走一遍patch的流程,不同的是,这次我们已经知道旧节点不存在(所以可以直接传入null)):patch(null,n2,container),怎么获得虚拟dom节点的container(真实节点),我们在挂载时(mountElement)将真实dom赋值给了虚拟dom的el属性,这样依赖,虚拟dom可以通过el获取到真实dom,我们就可以对虚拟dom进行卸载或更新了。
  3. 当新children是null时,如果旧children是数组,那就需要先逐一卸载,然后设置container的文本内容为空字符串,如果旧children是字符串或null,无论是那种情况,都需要设置container的文本内容为空字符串就可以了,因为新的children是null
