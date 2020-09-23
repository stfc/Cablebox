// Global config variable
var config
// Global array to store pdu type ids
var netbox_pdu_types = []
// Global string to store query string of pdu type ids
// Overcomes limitation that cannot pass hash of ids as they all have the same identifier
var netbox_pdu_types_query = ''
// Global variable to store rack DOM structure before adding to page
var racks = {}

var device_primaryip = {}
var device_ipmiip = {}

// Utility function for extracting a number from an html string 
// and inversely sorting on that value
function extractsort (a, b) {
      const pattern = />\d+</
      const pattern2 = /\d+/
      var a_val = pattern2.exec(pattern.exec(a))
      var b_val = pattern2.exec(pattern.exec(b))
      return b_val - a_val
    }
	
// Wrapper function for querying netbox
// TODO Determine whether auth token is required for r/o access
function netbox_query () {
  switch (arguments.length) {
    case 2:
      return (netbox_query(arguments[0], 'format=json', arguments[1]))
      break
    case 3:
      return (
        $.when(
          $.ajax({
            dataType: 'json',
            headers: {
              'Authorization': 'Token ' + config.netbox_api_key
            },
            url: config.netbox_url + arguments[0],
            data: arguments[1]
          })
        ).then(arguments[2])
      )
      break
    default:
      break
  }
}

// Wrapper function for running queries against php that queries pdus
function pdu_query (command, pdu, device_type, handler) {
  $.ajax({
    dataType: 'json',
    url: config.pdu_url,
    data: {
      command: command,
      ip: pdu,
      device_type: device_type
    },
    success: handler,
    error: function (a, b, c) {
      console.log(a)
      console.log(b)
      console.log(c)
    }
  })
}

// Debug callback that spits out returned JSON to bottom of page
function debug_callback (data) {
  $('<pre/>', {
    'class': 'debug',
    html: JSON.stringify(data, null, 2)
  }).appendTo('.container')
}

// Utility function to strip the netmask from ip addresses from netbox
function trim_netmask (ip) {
  pattern = /\/[1-9][0-9]*$/
  return ip.replace(pattern, '')
}

// Callback function that generates list of rackgroups
function rackgroups_callback (data) {
  var rackgroups = []

  // Iterate over the list of rack groups, generating a link to each one
  $.each(data.results, function (key, val) {
    rackgroups.push("<li id='" + val.id + "'><a href=\"./cablebox.html?group=" + val.slug + '">' + val.name + '</a></li>')
  })

  $('<ul/>', {
    'class': 'rack-groups',
    html: rackgroups.join('')
  }).appendTo('.container')
}

function popupIpmi (device_id) {
	$('h5.modal-title').text('Ipmi Control')
    $('.modal').modal();
}

function popupPdu (device_id,socket_id) {
	$('h5.modal-title').text('PDU Control')
    $('.modal').modal();
}

function addIpmiColumn () {
	$.each(device_ipmiip, function(device_id, ipmiip) {
		$("[data-nbid='device-" + device_id + "']").parent().attr('colspan', 1).after('<td onclick="popupIpmi('+ device_id +'); return false"></td>')
	})
	return Promise.resolve()
}

// Add additional Bootstrap styling
// Called once all promises setting up html structure are done
function addStyling () {
  $('div.pdus').addClass('row')
  $('table.pdu').addClass('col-sm')
  $('table').addClass('table table-sm table-bordered')
  $('thead').addClass('thead-light')
  $('th.pdu').addClass('col-10')
  //$('th.ipmi').addClass('col-1')
  $('th.power').addClass('col-1')
}

// Call back function that processes list of racks
function racks_callback (data) {
  var rack_promises = []

  var rack_container = $('<ul/>', {
    'class': 'racks'
  }).appendTo('.container')

  // Create the HTML heading for eack rack and the div that pdus will be added to
  // And fire off netbox queries for each rack
  $.each(data.results, function (key, val) {
    racks[val.id] = $("<li id='rack-" + val.id + "'></li>").appendTo(rack_container)
    $('<h2>' + val.display_name + '</h2>').appendTo(racks[val.id])
    $('<div/>', {
      'class': 'pdus'
    }).appendTo(racks[val.id])
    rack_promises.push(netbox_query('dcim/devices/', 'rack_id=' + val.id, rack_device_callback))
  })

  return (Promise.all(rack_promises).then(addIpmiColumn).then(addStyling))
}

function rack_device_callback (data) {
  var pdu_promises = []
  var ipmi_promises = []
  var children = {}
  var rack_id = -1

  $.each(data.results, function (key, val) {
	var pdu_title = ''
    if (rack_id == -1) {
      rack_id = val.rack.id
    }
    // If this is a PDU: add a table for it, query its  outlets and if it has an ip snmp query it
    if (netbox_pdu_types.includes(val.device_type.id)) {
      var pdu_promise = netbox_query('dcim/power-outlets/', {
        'device_id': val.id
      }, power_outlet_callback.bind(this, val.rack.id))
      pdu_promises.push(pdu_promise)

      // Once we've got the netbox info for the PDU, and queried the PDU status, add the status to the DOM
      // TODO - now the item is detached - need to think about how to do this properly
      if (val.primary_ip != null) {
        //	$.when(pdu_promise,pdu_query('readPDU',trim_netmask(val.primary_ip.address), val.device_type.id)).done(pdu_query_callback.bind(this,val.id));
		pdu_title='<a href=http://' + trim_netmask(val.primary_ip.address) + '>' + val.name + '</a>'
      } else {
      	pdu_title = val.name
      }
	  
      racks[val.rack.id].find('div.pdus').append(
        $('<table>', {
          id: 'pdu-' + val.id,
          class: 'pdu',
          html: '<thead><tr><th class=pdu>' + pdu_title + "</th><th class=ipmi>I</th><th class=power>A</th></tr></thead><tbody id='pdu-" + val.id + "'></tbody>"
        })
      )
    }

	if (val.primary_ip != null) {
	  device_primaryip[val.id] = val.primary_ip.address
	}

    // Add to the children hash for the parent device
    // Can't use id attribute for devices as they may appear multiple times if powered from multiple pdus and id must be unique to be valid HTML
    // If the child entry is undefined assign otherwise append
    if (val.parent_device != null) {
      if (typeof children[val.parent_device.id] === 'undefined') {
        children[val.parent_device.id] = "<tr><td colspan=2><div data-nbid='device-" + val.id + "'>" + val.display_name + '</div></td></tr>'
      } else {
        children[val.parent_device.id] += "<tr><td colspan=2><div data-nbid='device-" + val.id + "'>" + val.display_name + '</div></td></tr>'
      }
    }

	// Initiate search for an ipmi ip address for this device
    ipmi_promises.push(netbox_query('dcim/interfaces/', {
			'device_id': val.id,
			'mgmt_only': 'True',
	}, interface_callback));	
  } )

  // Setup promise that once all the netbox pdu work is done, add the child devices to the parents,
  // then add the ipmi column to needed hosts
  // Skip if no devices in the rack

  if (rack_id > 0) {
    return Promise.all(pdu_promises).then(function (rack_id, children) {
      $.each(children, function (id, data) {
        var obj = racks[rack_id].find("[data-nbid='device-" + id + "']")
        console.log('Device ' + id + ' Number of parent refs found=' + obj.length)
        obj.addClass('chassis')
        obj.append(
          $('<div />', {
            class: 'children',
            html: '<table>' + data + '</table>'
          }))
      })
    }.bind(this, rack_id, children))
  } else {
    return Promise.resolve()
  }
}

// Callback function for ipmi device
// Determine whether host has an ipmi device (mgmt_only interface whose ip does not match primary_ip)
// The query this is the callback to limits to mgmt_only=True interfaces
function interface_callback (data) {
  if (data.count == 0) {
    // No interfaces defined so nothing more to do
    return Promise.resolve()
  } else if (data.count > 1) {
    console.log('Multiple mgmt interfaces for device ' + device_id + ' - possible weirdness!')
    // If we have multiple mgmt address that have ips that aren't primary then we are in real trouble
	return Promise.resolve()
  } else {
    // Get ip address(es?) associated with interface
    return netbox_query('ipam/ip-addresses/', {
    	 interface_id: data.results[0].id
     }, ipaddress_callback)
  }
}

function ipaddress_callback (data) {
	if (data.count > 1) {
		console.log('WARNING: Multiple ip address returned for management interface on device' + data.results[0].interface.device.id)
	}
	$.each(data.results, function(key,val) {
		if (val.address != device_primaryip[val.interface.device.id]) {
			device_ipmiip[val.interface.device.id] = val.address
			console.log('Identified ' + val.address + ' as mgmt interface for device ' + val.interface.device.id + ' primary ip ' + device_primaryip[val.interface.device.id])
		}
	})
	return Promise.resolve()
}

// Process the returned pdu socket information
// TODO  decide if this is still needed - currently unused
function pdu_query_callback (device_id, data) {
  $.each(data, function (socket_id, socket_status) {
    switch (socket_status) {
      case 'on':
      case 'off':
      case 'unsupported':
        $('td#device-' + device_id + '-socket-' + socket_id).removeClass('socket-noinfo socket-on socket-off socket-unsupported').addClass('socket-' + socket_status)
        break
      default:
        // TODO Some sort of error raised here?
        break
    }
  })
}

// Setup the table structure for the power outlets for pdu
// And initate queries for the devices at the other end of the connected outlets
function power_outlet_callback (rack_id, data) {
  var outlets = []
  const extract_number = /\d+$/
  var parent_pdu = -1
  var outlet_promises = []
  var outlet_query_list = []

  if (data.count > 0) {
    $.each(data.results, function (key, val) {
	  var html_string='<tr><td colspan=2 '
      var socket_number = 0
      if (parent_pdu < 0) {
        parent_pdu = val.device.id
      }
      if (val.connected_endpoint == null) {
		html_string += '>EMPTY'  
      } else {
        // Use dummy name that will be replaced later
		html_string += 'id=power-' + val.connected_endpoint.id + '>&nbsp;'
        // Add the port to the list to be queried
        outlet_query_list.push(val.connected_endpoint.id)
      }
      // Extract the socket number by assuming it will always be the last digits of the name of the outlet
	  socket_number = extract_number.exec(val.name)
	  html_string += "</td><td class=socket-noinfo id='device-" + val.device.id + '-socket-' + socket_number + "'>" + socket_number + '</td></tr>'
	       
      // Create the table row for this outlet
      outlets.push(html_string)
    })
    // Sort the outlets 
    outlets.sort(extractsort)
    racks[rack_id].find('tbody#pdu-' + parent_pdu).append(outlets.join(''))
  }
  // Fire off netbox queries against the connected ports
  outlet_promises = outlet_query_list.map(function (port) {
    return netbox_query('dcim/power-ports/' + port + '/', power_port_callback.bind(this, rack_id))
  })

  return Promise.all(outlet_promises)
}

// Once we have power port information, update the appropriate table entry with the device name
function power_port_callback (rack_id, data) {
  // Search for the item in the appropriate rack data
  var obj = racks[rack_id].find('#power-' + data.id)
  // Update the item with the display name
  // Can't use id attribute for devices as they may appear multiple times if powered from multiple pdus
  obj.html("<div data-nbid='device-" + data.device.id + "'>" + data.device.display_name + '</div>')
  return Promise.resolve()
}

// Stash the retrieved netbox device types that have is_pdu set into global variable
function pdu_types_callback (data) {
  $.each(data.results, function (key, val) {
    netbox_pdu_types.push(val.id)
  })
  netbox_pdu_types_query = $.param({
    device_type_id: netbox_pdu_types
  }, true)
}

function rackgroup (group) {
  netbox_query('dcim/racks/', {
    'group': group
  }, racks_callback)
}

function intro () {
  netbox_query('dcim/rack-groups/', rackgroups_callback)
}

// The main function called when the page is ready
$(function () {
  // get the info from the config file and if that succeeds proceed onwards
  $.getJSON('./cablebox.config.json', function (data) { config = data }).done(function () {
    // Get any parammeters in the http request
    const urlParams = new URLSearchParams(window.location.search)

    // If we don't know which netbox devices are pdus, initiate a query for them
    if (netbox_pdu_types.length == 0) {
      netbox_query('dcim/device-types/', 'power_outlets=True', pdu_types_callback)
    }

    // If we have a rack group parameter display the rack group, otherwise show the intro page (list of rackgroups)
    if (urlParams.has('group')) {
      rackgroup(urlParams.get('group'))
    } else {
      intro()
    }
  })
})
