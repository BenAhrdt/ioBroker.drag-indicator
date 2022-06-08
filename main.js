"use strict";

/*
 * Created with @iobroker/create-adapter v2.1.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const schedule = require("node-schedule");
const { isDeepStrictEqual } = require("util");

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
			min : ".min",
			reset : ".reset"
		};

		this.observedValuesId = "observed_Values.";
		this.cronJobs = {};
		this.jobId = "jobId";

		// define arrays for selected states and calculation
		this.activeStates = {};
		this.activeStatesLastAdditionalValues = {};
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Initialize your adapter here

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
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			// clear all schedules
			for(const cronJob in this.cronJobs)
			{
				schedule.cancelJob(this.cronJobs[cronJob][this.jobId]);
			}
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
		this.activeStates[id].customInfo = customInfo;
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
				if(this.common.loglevel == "debug"){
					this.log.debug(`state ${tempId} added / activated`);
				}
				this.subscribeStates(tempId);
				this.activeStatesLastAdditionalValues[this.namespace + "." + tempId] = id;
				this.setState(tempId,false,true);
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
						write: true
					},
					native: {},
				});
				if(this.common.loglevel == "debug"){
					this.log.debug(`state ${tempId} added / activated`);
				}
				this.subscribeStates(tempId);
				const lastState = await this.getStateAsync(tempId);
				if(lastState !== undefined && lastState !== null){
					this.activeStatesLastAdditionalValues[this.namespace + "." + tempId] = lastState.val;
				}
				else{
					this.activeStatesLastAdditionalValues[this.namespace + "." + tempId] = state.val;
					this.setState(tempId,state.val,true);
				}
			}
		}
		if(customInfo.resetCronJob != ""){
			if(!this.cronJobs[customInfo.resetCronJob]){
				this.cronJobs[customInfo.resetCronJob] = {};
				this.cronJobs[customInfo.resetCronJob][this.jobId] = schedule.scheduleJob(customInfo.resetCronJob,this.resetWithCronJob.bind(this,customInfo.resetCronJob));
			}
			this.cronJobs[customInfo.resetCronJob][this.createStatestring(id)] = {};
			this.activeStates[id].lastCronJob = customInfo.resetCronJob;
		}
		else
		{
			this.activeStates[id].lastCronJob = "";
		}

		// Subcribe main state
		if(countUpSubscibecounter){
			this.subscribeForeignStates(id);
			this.subscribecounter += 1;
			this.setState(this.subscribecounterId,this.subscribecounter,true);
		}
	}

	// if the id is scheduled, it will be deleted from active array
	removefromCronJob(cronJob,id)
	{
		if(this.activeStates[id].lastCronJob != ""){
			delete this.cronJobs[cronJob][this.createStatestring(id)];
			if(Object.keys(this.cronJobs[cronJob]).length <= 1)
			{
				if(this.common.loglevel == "debug"){
					this.log.debug("job canceled: " + cronJob);
				}
				schedule.cancelJob(this.cronJobs[cronJob][this.jobId]);
				delete this.cronJobs[cronJob];
			}
			this.activeStates[id].lastCronJob = "";
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
			this.removefromCronJob(this.activeStates[id].lastCronJob,id);
			delete this.activeStates[id];
			this.subscribecounter -= 1;
			this.setState(this.subscribecounterId,this.subscribecounter,true);
			if(!this.activeStatesLastAdditionalValues[id]){ // Dont unsubscribe in case of is additional value
				this.unsubscribeForeignStates(id);
				if(this.common.loglevel == "debug"){
					this.log.debug(`state ${id} not longer subscribed`);
				}
			}
			else{
				if(this.common.loglevel == "debug"){
					this.log.debug(`state ${id} not longer subscribed as active state, but still as additional`);
				}
			}
		}
		if(this.config.deleteStatesWithDisable || deleteState){
			for(const myId in this.additionalIds){
				const tempId = this.createStatestring(id) + this.additionalIds[myId];
				const myObj = await this.getObjectAsync(tempId);
				if(myObj){
					this.unsubscribeStatesAsync(tempId);
					if(this.common.loglevel == "debug"){
						this.log.debug(`state ${tempId} removed`);
					}
					this.delObjectAsync(tempId);
					if(this.common.loglevel == "debug"){
						this.log.debug(`state ${this.namespace}.${tempId} deleted`);
					}
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
				if(!obj.common.custom || !obj.common.custom[this.namespace]){
					if(this.activeStates[id])
					{
						this.clearStateArrayElement(id,false);
						return;
					}
				}
				else{
					const customInfo = obj.common.custom[this.namespace];
					if(this.activeStates[id])
					{
						const state = await this.getForeignStateAsync(id);
						if(state){
							if(!isDeepStrictEqual(this.activeStates[id].customInfo,customInfo)){
								this.removefromCronJob(this.activeStates[id].lastCronJob,id);
								await this.addObjectAndCreateState(id,obj.common,customInfo,state,false);
							}
						}
					}
					else
					{
						const state = await this.getForeignStateAsync(id);
						if(state)
						{
							this.addObjectAndCreateState(id,obj.common,customInfo,state,true);
						}
						else
						{
							this.log.error(`could not read state ${id}`);
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

	resetWithCronJob(cronJob){
		for(const ele in this.cronJobs[cronJob]){
			if(ele != this.jobId){
				this.resetValues(this.namespace + "." + ele + this.additionalIds.reset,this.namespace.length,this.additionalIds.reset.length);
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
					}
					else{
						tempId = this.createStatestring(id) + this.additionalIds.min;
						if(state.val < this.activeStatesLastAdditionalValues[this.namespace + "." + tempId]){
							const tempValue = state.val;
							this.activeStatesLastAdditionalValues[this.namespace + "." + tempId] = tempValue;
							this.setStateAsync(tempId,tempValue,true);
						}
					}
				}

				// Check Changes in internal States (also if id is active state)
				if(this.activeStatesLastAdditionalValues[id] !== undefined && this.activeStatesLastAdditionalValues[id] !== null && !state.ack){
					const extentionLength = this.additionalIds.reset.length;
					const extention = id.substring(id.length - extentionLength);
					const prefixLengt = this.namespace.length;
					const prefix = id.substring(0,prefixLengt);
					if(extention == this.additionalIds.reset && prefix == this.namespace){
						// check that reset is true
						if(state.val == true){
							this.resetValues(id,prefixLengt,extentionLength);
							this.setStateAsync(id,true,true);
						}
						else{
							this.setStateAsync(id,false,true);
						}
					}
					else{
						this.activeStatesLastAdditionalValues[id] = state.val;
						this.setStateAsync(id,state.val,true);
					}
				}
			}

		} else {
			// The state was deleted
			if(this.common.loglevel == "debug"){
				this.log.debug(`state ${id} deleted`);
			}
		}
	}

	async resetValues(id,prefixLengt,extentionLength){
		const subId = id.substring(prefixLengt + 1,id.length - extentionLength);
		// Get current state
		const curState = await this.getForeignStateAsync(this.activeStatesLastAdditionalValues[id]);
		if(curState){
			this.activeStatesLastAdditionalValues[this.namespace + "." + subId + this.additionalIds.max] = curState.val;
			this.setStateAsync(subId + this.additionalIds.max,curState.val,true);
			this.activeStatesLastAdditionalValues[this.namespace +  "." + subId + this.additionalIds.min] = curState.val;
			this.setStateAsync(subId + this.additionalIds.min,curState.val,true);
		}
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
	// 			this.log.debug("send command");

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