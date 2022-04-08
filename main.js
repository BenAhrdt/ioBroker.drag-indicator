"use strict";

/*
 * Created with @iobroker/create-adapter v2.1.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

// Load your modules here, e.g.:
// const fs = require("fs");

class DragIndicator extends utils.Adapter {

	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: "drag-indicator",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		this.on("objectChange", this.onObjectChange.bind(this));
		// this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));

		this.subscribecounterId = "info.subscribedStatesCount";
		this.subscribecounter = 0;

		this.additionalIds = {
			max : ".max",
			maxTime : ".maxTime",
			min : ".min",
			minTime : ".minTime",
			reset : ".reset"
		};

		this.observedValuesId = "observed_Values.";

		// define arrays for selected states and calculation
		this.activeStates = {};
		this.activeStatesLastAdditionalValues = {};
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Initialize your adapter here
		// Reset the connection indicator during startup
		this.setState("info.connection", false, true);

		// Creates the subscribed state count
		await this.setObjectNotExistsAsync(this.subscribecounterId, {
			type: "state",
			common: {
				name: "Count of subscribed states",
				type: "number",
				role: "indicator",
				read: true,
				write: false,
				def:0
			},
			native: {},
		});

		//Read all states with custom configuration
		const customStateArray = await this.getObjectViewAsync("system","custom",{});

		// Request if there is an object
		if(customStateArray && customStateArray.rows)
		{
			for(let index = 0 ; index < customStateArray.rows.length ; index++){
				if(customStateArray.rows[index].value !== null){
					// Request if there is an object for this namespace an its enabled
					if (customStateArray.rows[index].value[this.namespace] && customStateArray.rows[index].value[this.namespace].enabled === true) {
						const id = customStateArray.rows[index].id;
						const obj = await this.getForeignObjectAsync(id);
						if(obj){
							const common = obj.common;
							const state = await this.getForeignStateAsync(id);
							if(state){
								await this.addObjectAndCreateState(id,common,customStateArray.rows[index].value[this.namespace],state,true);
							}
						}
					}
				}
			}
		}

		this.subscribeForeignObjects("*");
		this.setState(this.subscribecounterId,this.subscribecounter,true);
		this.setState("info.connection", true, true);
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			// Here you must clear all timeouts or intervals that may still be active
			// clearTimeout(timeout1);
			// clearTimeout(timeout2);
			// ...
			// clearInterval(interval1);

			callback();
		} catch (e) {
			callback();
		}
	}

	async addObjectAndCreateState(id,common,customInfo,state,countUpSubscibecounter)
	{
		// check if custominfo is available
		if(!customInfo){
			return;
		}
		if(common.type != "number")
		{
			this.log.error(`state ${id} is not type number, but ${common.type}`);
			return;
		}
		this.activeStates[id] = {};

		// Create adapter internal object
		const tempId = this.createStatestring(id);
		await this.setObjectAsync(tempId,{
			type:"channel",
			common:{
				name: customInfo.channelName
			},
			native : {},
		});

		// create adapter internal states
		for(const myId in this.additionalIds){
			const tempId = this.createStatestring(id) + this.additionalIds[myId];
			if(this.additionalIds[myId] == this.additionalIds.reset){
				await this.setObjectNotExistsAsync(tempId,{
					type: "state",
					common: {
						name: myId,
						type: "boolean",
						role: "reset",
						read: true,
						write: true,
						def: false
					},
					native: {},
				});
				this.log.info(`state ${tempId} added / activated`);
				this.subscribeStates(tempId);
				this.activeStatesLastAdditionalValues[this.namespace + "." + tempId] = id;
				this.setState(tempId,false,true);
			}
			else if(this.additionalIds[myId] == this.additionalIds.maxTime || this.additionalIds[myId] == this.additionalIds.minTime){
				await this.setObjectNotExistsAsync(tempId,{
					type: "state",
					common: {
						name: myId,
						type: "string",
						role: "timestamp",
						read: true,
						write: false,
						def: this.getCurrentTimerstring()
					},
					native: {},
				});
				this.log.info(`state ${tempId} added / activated`);
				this.subscribeStates(tempId);
				this.setState(tempId,this.getCurrentTimerstring(),true);
			}
			else{
				await this.setObjectNotExistsAsync(tempId,{
					type: "state",
					common: {
						name: common.name,
						type: common.type,
						role: common.role,
						unit: common.unit,
						read: true,
						write: true,
						def: 0
					},
					native: {},
				});
				this.log.info(`state ${tempId} added / activated`);
				this.subscribeStates(tempId);
				this.activeStatesLastAdditionalValues[this.namespace + "." + tempId] = state.val;
				this.setState(tempId,state.val,true);
			}
		}

		// Subcribe main state
		if(countUpSubscibecounter){
			this.subscribeForeignStates(id);
			this.subscribecounter += 1;
			this.setState(this.subscribecounterId,this.subscribecounter,true);
		}
	}

	createStatestring(id){
		return `${this.observedValuesId}${id.replace(/\./g, "_")}`;
	}

	// clear the state from the active array. if selected the state will be deleted
	async clearStateArrayElement(id, deleteState)
	{
		// Unsubscribe and delete states if exists
		if(this.activeStates[id]){
			this.unsubscribeForeignStates(id);
			this.log.info(`state ${id} not longer subscribed`);
			delete this.activeStates[id];
			this.subscribecounter -= 1;
			this.setState(this.subscribecounterId,this.subscribecounter,true);
		}
		if(this.config.deleteStatesWithDisable || deleteState){
			for(const myId in this.additionalIds){
				const tempId = this.createStatestring(id) + this.additionalIds[myId];
				const myObj = await this.getObjectAsync(tempId);
				if(myObj){
					this.unsubscribeStatesAsync(tempId);
					this.log.info(`state ${tempId} removed`);
					this.delObjectAsync(tempId);
					this.log.info(`state ${this.namespace}.${tempId} deleted`);
				}
			}
			// Delete channel Object
			this.delObjectAsync(this.createStatestring(id));
		}
	}

	/***************************************************************************************
	 * ********************************** Changes ******************************************
	 ***************************************************************************************/

	async onObjectChange(id, obj) {
		if (obj) {
			try {
				// Load configuration as provided in object
				const stateInfo = await this.getForeignObjectAsync(id);
				if (!stateInfo) {
					this.log.error(`Can't get information for ${id}, state will be ignored`);
					return;
				} else
				{
					if(!stateInfo.common.custom || !stateInfo.common.custom[this.namespace]){
						if(this.activeStates[id])
						{
							this.clearStateArrayElement(id,false);
							return;
						}
					}
					else{
						const customInfo = stateInfo.common.custom[this.namespace];
						if(this.activeStates[id])
						{
							const state = await this.getForeignStateAsync(id);
							if(state){
								await this.addObjectAndCreateState(id,stateInfo.common,customInfo,state,false);
							}
						}
						else
						{
							const state = await this.getForeignStateAsync(id);
							if(state)
							{
								this.addObjectAndCreateState(id,stateInfo.common,customInfo,state,true);
							}
							else
							{
								this.log.error(`could not read state ${id}`);
							}
						}
					}
				}
			} catch (error) {
				this.log.error(error);
				this.clearStateArrayElement(id,false);
			}
		} else {
			// The object was deleted
			// Check if the object is kwnow
			const obj = await this.getObjectAsync(this.createStatestring(id) + this.additionalIds.consumed);
			if(this.activeStates[id] || obj)
			{
				this.clearStateArrayElement(id,true);
			}
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	async onStateChange(id, state) {
		if (state) {
			// Check if state.val is reachable
			if(state.val !== undefined && state.val !== null){
				// Check Changes in Foreign states
				if(this.activeStates[id]){
					let tempId = this.createStatestring(id) + this.additionalIds.max;
					if(state.val > this.activeStatesLastAdditionalValues[this.namespace + "." + tempId]){
						const tempValue = state.val;
						this.activeStatesLastAdditionalValues[this.namespace + "." + tempId] = tempValue;
						this.setStateAsync(tempId,tempValue,true);
						this.setStateAsync(this.createStatestring(id) + this.additionalIds.maxTime,this.getCurrentTimerstring(),true);
					}
					else{
						tempId = this.createStatestring(id) + this.additionalIds.min;
						if(state.val < this.activeStatesLastAdditionalValues[this.namespace + "." + tempId]){
							const tempValue = state.val;
							this.activeStatesLastAdditionalValues[this.namespace + "." + tempId] = tempValue;
							this.setStateAsync(tempId,tempValue,true);
							this.setStateAsync(this.createStatestring(id) + this.additionalIds.minTime,this.getCurrentTimerstring(),true);
						}
					}
				}

				// Check Changes in interneal States
				else if(this.activeStatesLastAdditionalValues[id] !== undefined && this.activeStatesLastAdditionalValues[id] !== null && !state.ack){
					const extentionLength = this.additionalIds.reset.length;
					const extention = id.substring(id.length - extentionLength);
					const prefixLengt = this.namespace.length;
					const prefix = id.substring(0,prefixLengt);
					if(extention == this.additionalIds.reset && prefix == this.namespace){
						const subId = id.substring(prefixLengt + 1,id.length - extentionLength);
						// Get current value
						const curValue = await this.getForeignStateAsync(this.activeStatesLastAdditionalValues[id]);
						if(curValue){
							this.setStateAsync(subId + this.additionalIds.max,curValue.val,true);
							this.setStateAsync(subId + this.additionalIds.maxTime,this.getCurrentTimerstring(),true);
							this.setStateAsync(subId + this.additionalIds.min,curValue.val,true);
							this.setStateAsync(subId + this.additionalIds.minTime,this.getCurrentTimerstring(),true);
							this.setForeignStateAsync(id,false,true);
						}
					}
					else{
						this.activeStatesLastAdditionalValues[id] = state.val;
						this.setForeignStateAsync(id,state.val,true);
					}
				}
			}

		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
		}
	}

	getCurrentTimerstring(){
		const cur = new Date();
		const year = cur.getFullYear();
		const month = cur.getMonth() + 1;
		const day = cur.getDate();
		const hour = cur.getHours();
		const minute = cur.getMinutes();
		const second = cur.getSeconds();
		return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
	}
	// If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
	// /**
	//  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	//  * Using this method requires "common.messagebox" property to be set to true in io-package.json
	//  * @param {ioBroker.Message} obj
	//  */
	// onMessage(obj) {
	// 	if (typeof obj === "object" && obj.message) {
	// 		if (obj.command === "send") {
	// 			// e.g. send email or pushover or whatever
	// 			this.log.info("send command");

	// 			// Send response in callback if required
	// 			if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
	// 		}
	// 	}
	// }

}


if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new DragIndicator(options);
} else {
	// otherwise start the instance directly
	new DragIndicator();
}