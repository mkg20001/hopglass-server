/*  Copyright (C) 2019 Milan Pässler
    Copyright (C) 2019 HopGlass Server contributors

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>. */

'use strict'

const async = require('async')
const _ = require('lodash')


module.exports = function(receiver, config) {

  function isOnline(node) {
    if (node)
      return Math.abs((node.lastseen ? new Date(node.lastseen) : new Date()) - new Date()) < config.offlineTime * 1000

    return true
  }

  function getNodesJson(stream, query) {
    const data = receiver.getData(query)
    const nJson = {}
    nJson.version = 2
    nJson.nodes = []
    nJson.timestamp = new Date().toISOString()
    const macTable = {}
    async.forEachOf(data, function(n, k, finished) {
      if (_.has(n, 'nodeinfo.network.mesh')) {
        for (const bat in n.nodeinfo.network.mesh) {
          for (const type in n.nodeinfo.network.mesh[bat].interfaces) {
            n.nodeinfo.network.mesh[bat].interfaces[type].forEach(function(d) {
              macTable[d] = k
            })
          }
        }
      }
      finished()
    }, function() {
      async.forEachOf(data, function(n, k, finished) {
        if (n.nodeinfo) {
          const node = {}
          node.nodeinfo = _.get(n, 'nodeinfo', {})
          node.flags = {}
          node.flags.gateway = _.get(n, 'nodeinfo.vpn') || _.get(n, 'nodeinfo.gateway')
          node.flags.online = isOnline(n)
          node.statistics = {}
          if (node.flags.online) {
            node.statistics.uptime = _.get(n, 'statistics.uptime')
            node.statistics.gateway = _.get(n, 'statistics.gateway')
            if (node.statistics.gateway in macTable)
              node.statistics.gateway = macTable[node.statistics.gateway]
            node.statistics.gateway_nexthop = _.get(n, 'statistics.gateway_nexthop')
            if (node.statistics.gateway_nexthop in macTable)
              node.statistics.gateway_nexthop = macTable[node.statistics.gateway_nexthop]
            node.statistics.nexthop = _.get(n, 'statistics.nexthop')
            if (node.statistics.nexthop in macTable)
              node.statistics.nexthop = macTable[node.statistics.nexthop]
            if (_.has(n, 'statistics.airtime') && Array.isArray(n.statistics.airtime))
              node.statistics.airtime = n.statistics.airtime
            else
              node.statistics.airtime = []
            if (_.has(n, 'statistics.memory'))
              node.statistics.memory_usage =
                  (_.get(n, 'statistics.memory.total', 0)
                - _.get(n, 'statistics.memory.free', 0)
                - _.get(n, 'statistics.memory.buffers', 0)
                - _.get(n, 'statistics.memory.cached', 0))
                / _.get(n, 'statistics.memory.total', 0)
            node.statistics.rootfs_usage = _.get(n, 'statistics.rootfs_usage')
            node.statistics.clients = {
              total: _.get(n, 'statistics.clients.total', 0),
              wifi: _.get(n, 'statistics.clients.wifi', 0),
              wifi24: _.get(n, 'statistics.clients.wifi24', 0),
              wifi5: _.get(n, 'statistics.clients.wifi5', 0)
            }
            node.statistics.loadavg = _.get(n, 'statistics.loadavg')
          }
          node.lastseen = _.get(n, 'lastseen', new Date().toISOString())
          node.firstseen = _.get(n, 'firstseen', new Date().toISOString())
          nJson.nodes.push(node)
        }
        finished()
      }, function() {
        stream.writeHead(200, { 'Content-Type': 'application/json' })
        stream.end(JSON.stringify(nJson))
      })
    })
  }

  function getGraphJson(stream, query) {
    const data = receiver.getData(query)
    const gJson = {}
    gJson.timestamp = new Date().toISOString()
    gJson.version = 1
    gJson.batadv = {}
    gJson.batadv.multigraph = false
    gJson.batadv.directed = true
    gJson.batadv.nodes = []
    gJson.batadv.links = []
    gJson.batadv.graph = null
    const nodeTable = {}
    const macTable = {}
    const typeTable = {}
    const ipTable = {}
    let counter = 0
    function createEntry(mac) {
      if (macTable[mac] && mac) {
        // this is a shitty hack for our other shitty hacks
        // this just aliases nodes that we already created
        // if our code failed to do so
        for (let i = 0; i < gJson.batadv.nodes.length; i++) {
          const node = gJson.batadv.nodes[i]
          if (node.node_id === macTable[mac]) {
            nodeTable[mac] = i
            return
          }
        }
      }

      const nodeEntry = {}
      nodeEntry.id = mac
      nodeEntry.node_id = macTable[mac]
      nodeTable[mac] = counter
      const node = data[macTable[mac]]
      if (_.has(node, 'neighbours.batadv'))
        for (const m in _.get(node, 'neighbours.batadv')) {
          nodeTable[m] = counter
        }
      if (_.has(node, 'nodeinfo.network.mesh'))
        for (const bat in node.nodeinfo.network.mesh) {
          for (const type in node.nodeinfo.network.mesh[bat].interfaces) {
            if (typeof node.nodeinfo.network.mesh[bat].interfaces[type].forEach == 'function')
              node.nodeinfo.network.mesh[bat].interfaces[type].forEach(function(m) {
                nodeTable[m] = counter
              })
          }
        }
      if (!isOnline(node))
        nodeEntry.unseen = true
      counter++
      gJson.batadv.nodes.push(nodeEntry)
    }
    async.forEachOf(data, function(n, k, finished1) {
      if (_.has(n, 'neighbours.batadv') && _.has(n, 'nodeinfo.network.mac'))
        for (const mac in n.neighbours.batadv) {
          macTable[mac] = k
        }
      if (_.has(n, 'neighbours.batadv') && _.has(n, 'nodeinfo.network.addresses'))
        for (const ip of n.nodeinfo.network.addresses) {
          ipTable[ip.replace(/\/\d+/g, '')] = k
        }
      if (_.has(n, 'nodeinfo.network.mesh'))
        for (const bat in n.nodeinfo.network.mesh) {
          for (const type in n.nodeinfo.network.mesh[bat].interfaces) {
            if (typeof n.nodeinfo.network.mesh[bat].interfaces[type].forEach == 'function')
              n.nodeinfo.network.mesh[bat].interfaces[type].forEach(function(d) {
                typeTable[d] = type
                macTable[d] = k
              })
          }
        }
      finished1()
    }, function() {
      async.forEachOf(data, function(n, k, finished2) {
        if (_.has(n, 'neighbours.batadv') && isOnline(n)) {
          for (let dest in n.neighbours.batadv) {
            if (_.has(n.neighbours.batadv[dest], 'neighbours'))
              for (let src in n.neighbours.batadv[dest].neighbours) {
                const ip = n.neighbours.batadv[dest].neighbours[src].olsr1_ip || n.neighbours.batadv[dest].neighbours[src].ip || n.neighbours.batadv[dest].neighbours[src].olsr2_ip

                if (!macTable[src]) {
                  if (ipTable[ip]) {
                    macTable[src] = ipTable[ip]
                    if (macTable[ipTable[ip]]) { // this avoids *some* duplicates, where it's easy
                      src = ipTable[ip]
                    }
                  }
                }

                const link = {}
                link.source = nodeTable[src]
                link.target = nodeTable[dest]
                const tq = _.get(n, ['neighbours', 'batadv', dest, 'neighbours', src, 'tq'])
                link.tq = 255 / (tq ? tq : 1)

                const ts = typeTable[src], td = typeTable[dest]
                if (ip.startsWith('10.12.11.') || ip === '2001:470:508d::12') {
                  // force tunnels for everything that's very clearly vpn
                  // some gateway links are also affected, but that clears the map up a bit
                  // so that's a feature not a bug
                  // (maybe we still want this, as the gw position in graph map
                  // doesn't follow vpn clients)
                  link.type = 'tunnel'
                  typeTable[src] = 'tunnel'
                  typeTable[dest] = 'tunnel'
                } else if (ts === 'l2tp' || td === 'l2tp') {
                  link.type = 'l2tp'
                } else if (ts === 'fastd' || td === 'fastd') {
                  link.type = 'fastd'
                } else if (ts === 'tunnel' || td === 'tunnel') {
                  link.type = 'tunnel'

                  if (td === 'tunnel' && (ts == undefined || ts === 'tunnel')) {
                    let fds = 0, tds = 0, sis = 0
                    if (_.get(data[macTable[dest]], 'nodeinfo.software.fastd.enabled', false)) fds++
                    if (_.get(data[macTable[src]], 'nodeinfo.software.fastd.enabled', false)) fds++
                    if (_.get(data[macTable[dest]], 'nodeinfo.software.tunneldigger.enabled', false)) tds++
                    if (_.get(data[macTable[src]], 'nodeinfo.software.tunneldigger.enabled', false)) tds++
                    if (_.has(data[macTable[dest]], 'nodeinfo.software')) sis++
                    if (_.has(data[macTable[src]], 'nodeinfo.software')) sis++
                    if (sis == fds && fds > 0) link.type = 'fastd'
                    if (sis == tds && tds > 0) link.type = 'l2tp'
                  }
                } else {
                  if (dest.match(/^manman\.\d+$/)) { // if dest is unspecific, then use source
                    link.type = typeTable[src]
                  } else {
                    link.type = typeTable[dest]
                  }
                }

                const manlong = /^(manman\.\d+)\.\d+$/
                if (src.match(manlong)) {
                  src = src.replace(manlong, (_, short) => short)
                }
                link.source = nodeTable[src]

                if (isNaN(link.source)) {
                  //unknown node (not in data) -> create nodeentry
                  createEntry(src)
                  link.source = nodeTable[src]
                }
                if (isNaN(link.target)) {
                  createEntry(dest)
                  link.target = nodeTable[dest]
                }
                gJson.batadv.links.push(link)
              }
          }
        }
        finished2()
      }, function() {
        stream.writeHead(200, { 'Content-Type': 'application/json' })
        stream.end(JSON.stringify(gJson))
      })
    })
  }

  const exports = {
    /* eslint-disable quotes */
    "nodes.json": getNodesJson,
    "graph.json": getGraphJson
  }
  return exports
}
