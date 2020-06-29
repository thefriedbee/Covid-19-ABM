var d3 = require("d3");
var $ = require('jquery');
require('bootstrap-slider');

// declare all gloabal variables in the front
var IDs = ["numDayPerSecond",
    "numCommunity", "numSAgent", "numICommunity", "numIAgent",
    "infectRadius", "infectChance", "infectDays",
    "numDaysBeforeQuaranteed", "socialDistance", "travelProb"];
var sliders = {};
var startStopFlag = 0; // 0: running; 1: paused 2: stopped
var ifQuaranteed = true; // if apply quaranteed

// community tiles and agent objects.
var agents = [], idCount = 0;
var communities=[];

// plot dimensions
var margin = {top: 10, right: 50, bottom: 10, left: 50}

// simulation time controllers and key time information
var timeControllers = [];
var lastDailyTime = 0;
var pausedTime = 0, stoppageTime = 0;
var dailyCycleTime = 0;
// a day counter, plus one after every simulation day!
var dayCount = 0;

// object array for plotting data and key elements
var countsArray = [];
var plotElements = {};


// define agent class with three attributes: e.g., x, y coordinates at a given time
// x, y are relative position from 0 to 1 IN THE COMMUNITY BOX/svg!
class Agent {
    //          svg, x, y, id, speed, angle, status, svgRect
    constructor(svg, x, y, id, speed, angle, status, svgRect) {
        this.svg = svg;
        this.posX = x;
        this.posY = y;
        this.id = id;
        this.radius = 3; // ball radius for visual.
        // this.infectRadius = sliders.infectRadius.value; // temp
        // console.log("Infect radius: "+this.infectRadius);
        this.speed = speed;
        this.angle = angle;
        this.status = status;
        this.statusTime = dayCount; // initial Time of current status

        this.data = [this.id]; // allow us to use d3.enter()
        if(status == "S"){
            this.color = 'green';
        } else if (status == "I") {
            this.color = 'red';
        } else {// recovered agents
            this.color = 'grey';
        }
        // compute v_x, v_y
        this.vx = Math.cos(this.angle) * this.speed; // velocity x
        this.vy = Math.sin(this.angle) * this.speed; // velocity y
        // force for social distancing
        this.forceX = 0;
        this.forceY = 0;

        // update to true scaled position
        this.svgRect = svgRect; // sibling rectangle of constraints in community
        this.setXY(); // set x and y based on box rect position

        // if quaranteed
        this.quaranteed = false;
        var str = svgRect.attr("id");
        this.home = str.split("_")[1];
    }
    // update to true scaled position
    setXY(){
        var re = this.svgRect;
        // console.log("posX: "+this.posX+"; posY: "+this.posY);
        var x = re.attr("x"), y = re.attr("y"), w = re.attr("width"), h = re.attr("height");
        // console.log("x, y, h, w:"+x+","+y+","+w+","+h);
        this.posX = this.posX * w + Number(x);
        this.posY = this.posY * h + Number(y);
        // console.log("posX: "+this.posX+"; posY: "+this.posY);
        // store box info
        this.boxLeft = x;
        this.boxTop = y;
        this.boxRight = parseInt(x) + parseInt(w);
        this.boxBottom = parseInt(y) + parseInt(h);
    }
    // divide each box to 20 * 20 grids, compute the grid index it falls into

    // initialize the DOM
    Draw(){
        var svg = this.svg;
        // console.log(this.id);
        // console.log(svg);
        var ball = svg.selectAll('#'+this.id).data(this.data);
        
        ball.enter()
            .append('circle')
            .attr("r", this.radius)
            .style("fill", this.color)
            .attr("id", this.id)
            .style("stroke", "black")
            .style("stroke-width", "1px");
        ball.attr("cx", this.posX)
            .attr("cy", this.posY)
            .style("fill", this.color);
    }

    // Step move function
    Move(){
        // if (this.id == "ag1"){
        //     console.log("object ag1 moved, x is:"+ this.posX+", object y is: "+this.posY);
        // }
        this.posX += this.vx;
        this.posY += this.vy;
        // check if hit the frame rectangle for x axis (right)
        // console.log("Rect width"+svgRect.attr('width'));
        // console.log(this.posX+"    "+this.radius);
        // console.log(parseInt(this.boxRight)+"  "+parseInt(this.posX)+"  "+parseInt(this.radius));
        // console.log("x pos - radius", parseInt(this.boxRight) -parseInt(this.posX) - parseInt(this.radius));
        if (parseInt(this.boxRight) <= parseInt(this.posX) + parseInt(this.radius)) {
            // console.log("hit right");
            this.posX = parseInt(this.boxRight) - parseInt(this.radius) - 1;
            this.angle = Math.PI - this.angle;
            this.vx = -this.vx;
        }
        // (left)
        if (parseFloat(this.posX) - parseInt(this.radius) < parseInt(this.boxLeft)) {
            // console.log("hit left");
            this.posX = parseInt(this.boxLeft) + parseInt(this.radius) + 1;
            this.angle = Math.PI - this.angle;
            this.vx = -this.vx;
        }
        // do the same for y axis (bottom)
        if (parseInt(this.boxBottom) < parseFloat(this.posY + this.radius)) {
            // console.log("hit bottom");
            this.posY = parseInt(this.boxBottom) - parseInt(this.radius) - 1;
            this.angle = 2 * Math.PI - this.angle;
            this.vy = -this.vy;
        }
        // (top)
        if (parseFloat(this.posY) - parseFloat(this.radius) < parseInt(this.boxTop)) {
            // console.log("hit top");
            this.posY = parseInt(this.boxTop) + parseFloat(this.radius)+1;
            this.angle = 2 * Math.PI - this.angle;
            this.vy = -this.vy;
        }
        // Just left this as sanity check, it should not be run
        if (this.angle > 2 * Math.PI){
            this.angle = this.angle - 2 * Math.PI;
        }
        if (this.angle < 0){
            this.angle = 2 * Math.PI + this.angle;
        }
        // if (this.id == "ag1"){
        //     console.log("object ag1 moved, x is:"+ this.posX+", object y is: "+this.posY);
        // }
        // console.log("x speed is: "+this.vx);
        // Finally, draw updated results!
        this.Draw();
    }

    // move with force
    forceMove(){
        // just update angle same with force
        var fX = this.forceX, fY = this.forceY;
        var theta = Math.atan(Math.abs(fY/fX));
        if (fY >= 0 && fX >= 0){
            this.angle = theta;
        } else if ( fY >= 0 && fX < 0) {
            this.angle = Math.PI - theta;
        } else if ( fY < 0 && fX < 0 ){
            this.angle = Math.PI + theta;
        } else {
            this.angle = 2 * Math.PI - theta;
        }
        // update speed
        this.vx = Math.cos(this.angle) * this.speed; // velocity x
        this.vy = Math.sin(this.angle) * this.speed; // velocity y
        if ( this.id == "ag1"){
            console.log("ag1's forces are, fx: "+ this.forceX+"; fy: "+ this.forceY);
            console.log("angle is "+this.angle+"ag1's speed is: "+this.vx+" "+this.vy);
        }
        this.Move();
    }

    checkRecover(){
        var today = dayCount;
        // If the guy has been sicked for long enough
        // console.log("The difference is "+(today - this.statusTime));
        if (today - this.statusTime > sliders.infectDays.value && this.status == "I"){
            // console.log("An item recovered!");
            this.status = "R"; // recovered
            this.color = "grey";
            this.Draw(); 
        }
    }

    // agent random traveling function with a set probability
    // Assumption: a guy travel to random place and come back
    moveCommunity(j){ // j: a number revealing the destination id.
        // step -1: check if it is out of home community,
        // if so, travel back to home; Otherwise, travel to proposed community j.
        var currentN = this.svgRect.attr("id").split("_")[1];
        if (currentN != this.home){
            j = this.home; // set back to home
        } else { // at home!
            if (j == this.home){ // wrongly proposed community to home, should not happen, stop move!
                return true;
            }
        }

        // step 0: if quaranteed, don't move
        if (this.quaranteed){
            return true;
        }
        // step 1: change community information for the agent
        var newSvg = d3.select("#canvas");
        var svgRect = newSvg.select("#rect_"+ j);
        this.svg = newSvg;
        this.svgRect = svgRect;

        var x = svgRect.attr("x"), y = svgRect.attr("y");
        var w = svgRect.attr("width"), h = svgRect.attr("height");
        // set target to the centriod of the new block
        var xCenter = parseFloat(x) + parseFloat(w/2), yCenter = parseFloat(y) + parseFloat(h/2);
        // step 3: transition agent object to new location; update bounding box
        this.boxLeft = x;
        this.boxTop = y;
        this.boxRight = parseInt(x) + parseInt(w);
        this.boxBottom = parseInt(y) + parseInt(h);
        this.posX = xCenter;
        this.posY = yCenter;

        // step 3: transition ball (svg object) to new centriod
        var ball = d3.select('#canvas').select('#'+this.id);
        ball.transition()
            .duration(500) // 0.5 second animation of traveling
            .attr("cx", xCenter)
            .attr("cy", yCenter);
    }

    // move to quarantee box
    moveToQuaranteeBox(){
        // step 0. mark agent as quaranteed
        this.quaranteed = true;
        // step 1. select box to send
        var newSvg = d3.select("#smallCanvas");
        var svgRect = newSvg.select("#rect_quarantee");
        this.svg = newSvg;
        this.svgRect = svgRect;
        
        var x = svgRect.attr("x")-margin.left+5, y = svgRect.attr("y")-margin.top+5;
        var w = svgRect.attr("width"), h = svgRect.attr("height");
        // console.log("move to location"+x+" "+y+" "+w+" "+h);
        // set target to the centriod of the new block
        var xCenter = parseFloat(x) + parseFloat(w/2)
        var yCenter = parseFloat(y) + parseFloat(h/2);
        // transition agent object to new location; update bounding box
        this.boxLeft = x;
        this.boxTop = y;
        this.boxRight = parseInt(x) + parseInt(w);
        this.boxBottom = parseInt(y) + parseInt(h);
        this.posX = xCenter;
        this.posY = yCenter;
        // step 3: transition ball (svg object) to new centriod
        var ball = d3.select("#smallCanvas").select('#'+this.id);
        ball.transition()
            .duration(500) // 0.5 second animation of traveling
            .attr("cx", xCenter)
            .attr("cy", yCenter);
    }

    // wipe out d3 plot before re-initiate
    wipeOut(){
        var svg = this.svg;
        var ball = svg.select('#'+this.id);
        ball.remove();
    }

    // TODO (lower priority): for social distancing, implementing a force compute (emulate social distance)
    // methods like get neighbors, etc.
}

// daily updation. e.g., recovered, quaranteed
function dailyUpdate(agent){
    // step 1. check sickness
    // check recovered every day!
    agent.checkRecover();

    // step 2. decide (randomly) whether agent needs to travel
    // console.log("Random number for Prob. of moving is: "+sliders.travelProb.value);
    if ( Math.random() <= sliders.travelProb.value && agent.quaranteed==false ) {
        // move to a random selected community with a probability
        var cN = parseInt(Math.random() * (sliders.numCommunity.value-1));
        if (cN >= agent.home){
            cN = cN + 1;
        }
        // console.log("Random number for Prob. of moving is: "+cN);
        agent.moveCommunity(cN);
    }
    agent.travel = false; // set back travel option after traveling

    // step 3. decide whether agent needs to be quaranteed
    // If so, send to quaranteed box and freeze its moving abilities
    if (ifQuaranteed){
        // have sick for exact number of days
        if (agent.status=="I" && (dayCount - agent.statusTime) == sliders.numDaysBeforeQuaranteed.value ){
            // console.log("Quaranteed this agent to the box!");
            agent.moveToQuaranteeBox();
        }
    }
    // step 4. for recovered agent, send it back to the a random community
    if (ifQuaranteed){
        // if agent recovered but still quaranteed in box
        if (agent.status=="R" && agent.quaranteed==true){
            agent.quaranteed=false;
            console.log("Move back to community!!!!");

            console.log("The home for this agent is: " + agent.home);
            agent.moveCommunity(agent.home);
        }
    }
}

// Check whether two balls are within same distance
// ASSUME ball1 is "I", ball2 is "S", update ball 2 status
// return true means updated, false means not updated
function updateInfect(ball1, ball2) {
    // only if ball1 is I and ball2 is S
    if (ball1.status == "I" && ball2.status == "S"){
        var absx = Math.abs(parseFloat(ball2.posX) - parseFloat(ball1.posX));
        var absy = Math.abs(parseFloat(ball2.posY) - parseFloat(ball1.posY));
        var infectRadius = sliders.infectRadius.value;
        // console.log(absx+ " " +absy);
        function getMax(a, b){ return (a>b)?a:b; }
        // coarse pre-check
        if (getMax(absx, absy) > infectRadius){
            return false;
        }
        // console.log("Found one infect pair after pre-check!");
        // calculate distance
        var distance = (absx*absx) + (absy*absy);
        distance = Math.sqrt(distance);
        // console.log(distance);
        // check if distance is less than sum of two radius - if yes, collision
        if (distance < parseFloat(infectRadius)) { // with infectious radius
            ball2.color = "red";
            ball2.status= "I";
            ball2.statusTime = dayCount;
            return true;
        }
        return false;
    }
    return false; // not correct status
}

// write a function update particle moving directions
// instead of modeling accelerate (and take care of simulation time), 
// decide speed direction to the direction of acceleration suits better for this project for simplificity
function updateForceBoth(ball1, ball2){
    var x1 = parseFloat(ball1.posX), x2 = parseFloat(ball2.posX);
    var y1 = parseFloat(ball1.posY), y2 = parseFloat(ball2.posY);
    var absx = Math.abs(x2 - x1);
    var absy = Math.abs(y2 - y1);
    var distSqared = absx*absx + absy*absy;
    var theta =  parseFloat(Math.atan(absy/absx) * 180 / Math.PI);
    console.log("angle theta is:"+ theta+"; the values are"+x1+" "+x2+" "+y1+" "+y2);
    var force = 1 / distSqared;
    var forceX = force * Math.sin(theta);
    var forceY = force * Math.cos(theta);
    // compute force along axis (with direction)
    if (x1 >= x2){
        var forceX1 = forceX;
        var forceX2 = -forceX;
    } else {
        var forceX1 = -forceX;
        var forceX2 = forceX;
    }
    if (y1 >= y2){
        var forceY1 = forceY;
        var forceY2 = -forceY;
    } else {
        var forceY1 = -forceY;
        var forceY2 = forceY;
    }
    ball1.forceX += forceX1; ball1.forceY += forceY1;
    ball2.forceX += forceX2; ball2.forceY += forceY2;
} 


// Define a summary object,
// each denotes counts of patient at each time and time descriptive statistics.
class CountStats{
    constructor (allAgents){
        var suspected=0, infected=0, removed=0;
        this.total = allAgents.length;
        // iterate agents to check their status after daily updates
        for (var i in allAgents){
            switch(allAgents[i].status){
                case "S": ++suspected; break;
                case "I": ++infected; break;
                case "R": ++removed; break;
            }
        }
        this.S = suspected/this.total;
        this.I = infected/this.total;
        this.R = removed/this.total;
        console.log("Suspected: "+this.S+"; Infected: "+this.I+"; Removed: "+this.R+"; All: "+this.total);
    }
}


// initialize elements to plot stats
function initGraphs(){
    // basic dims of the graph
    var width = 500 - margin.left - margin.right;
    var height = 350 - margin.top - margin.bottom;
    plotElements.timeLength = 5;
    var tl = plotElements.timeLength;
    // select the root svg for plotting
    plotElements['svg'] = d3.select(".plot").append("svg")
                .attr("width", width + margin.left + margin.right)
                .attr("height", height + margin.top + margin.bottom)
                .append("g")
                .attr("transform",
                    "translate(" + margin.left + "," + margin.top + ")");
    // plot y axis, which won't change duringed under simulation context
    plotElements['yScale'] = d3.scaleLinear().domain([0, 1]).range([height, 0]);
    plotElements['xScale'] = d3.scaleLinear().domain([0, tl]).range([0, 500]);
    var svg = plotElements['svg'];
    var xScale = plotElements['xScale'], yScale = plotElements['yScale'];
    svg.append("g").attr("id", "yAxis").call(d3.axisLeft(yScale));
    svg.append("g").attr("id", "xAxis")
        .attr("transform", "translate(0,"+height+")")
        .call(d3.axisBottom(xScale));
    plotElements.areaSPlot = svg.append("path").attr("id", "filledSArea");
    plotElements.areaIPlot = svg.append("path").attr("id", "filledIArea");
    plotElements.areaRPlot = svg.append("path").attr("id", "filledRArea");
}

// a function to create/update stats plots
function plotCounts(countsArray){
    // basic dims of the graph
    var margin = {top: 10, right: 30, bottom: 30, left: 50},
        width = 500 - margin.left - margin.right,
        height = 350 - margin.top - margin.bottom;
    var svg = plotElements['svg'];
    // select dom to update scatter plot
    var circles = svg.selectAll("circle").data(countsArray);
    // import/update two axis scales, redraw x axis
    var timeLength = countsArray.length;
    // console.log("timeLength is: "+timeLength);
    plotElements['xScale'] = d3.scaleLinear().domain([0, timeLength]).range([0, 500]);
    var yScale = plotElements['yScale'];
    var xScale = d3.scaleLinear().domain([0, timeLength]).range([0, 500]);
    svg.select("#xAxis")
        .attr("transform", "translate(0,"+height+")")
        .call(d3.axisBottom(xScale));
    // plot scatterplot
    // circles.enter().append("circle");
    // circles.attr("cx", function(d, i) { return xScale(i) })
    //     .attr("cy", function(d) {return yScale(d.S) })
    //     .attr("r", 2);
    // plot area
    var areaSPlot = plotElements.areaSPlot;
    var areaIplot = plotElements.areaIPlot;
    var areaRplot = plotElements.areaRPlot;
    areaSPlot.datum(countsArray)
        .attr("fill", "green") // plot suspect area #cce5df
        .attr("stroke", "#69b3a2")
        .attr("stroke-width", 1.5)
        .attr("d", d3.area().x(function(d, i) { return xScale(i) })
                            .y0(yScale(0))
                            .y1(function(d, i) { return yScale(d.S) })
        );
    areaIplot.datum(countsArray)
        .attr("fill", "red") // plot infected area
        .attr("stroke", "#69b3a2")
        .attr("stroke-width", 1.5)
        .attr("d", d3.area().x(function(d, i) { return xScale(i) })
                            .y0(function(d, i) { return yScale(d.S) })
                            .y1(function(d, i) { return yScale(d.S+d.I) })
        );
    areaRplot.datum(countsArray)
        .attr("fill", "grey") // plot removed area
        .attr("stroke", "#69b3a2")
        .attr("stroke-width", 1.5)
        .attr("d", d3.area().x(function(d, i) { return xScale(i) })
                            .y0(function(d, i) { return yScale(d.S+d.I) })
                            .y1(function(d, i) { return yScale(1) })
        );
    
}


// initialize plotting canvas
function initCanvas(){
    // frame of the canvas
    var margin = {top: 10, right: 50, bottom: 30, left: 50},
        w = 500 - margin.left - margin.right,
        h = 350 - margin.top - margin.bottom;
    var communityWidth = 100, communityHeight = 100;

    var svg = d3.select("body");
    // set number of sub-canvas (communities)
    // let the size of sub-canvas the same,
    // return a array of objects, each contains the pixels of the object
    var funcSetCanvas = function(num=8){
        var width = communityWidth, height = communityHeight;
        var i, boxes = [];
        for (i = 0; i < num; i++) {
            var tlr = i*width % (4*width), tlc = Math.floor(i/4)*height;
            var box = [tlr, tlc];
            boxes.push( box );
        }
        return boxes;
    }
    // an Array of community drawing boxes
    communities = funcSetCanvas(parseInt(sliders.numCommunity.value));
    // before init, delete old canvaes (if there is any)
    svg.select("#bigCanvas").select("svg").remove();
    // now replot the canvas and the community blocks
    var svg = svg.select("#bigCanvas")
                .append("svg")
                .attr("width", w + margin.left + margin.right)
                .attr("height", h + margin.top + margin.bottom)
                .attr("id", "smallCanvas");
    
    svg.append("rect").attr("x", 0).attr("y",  0)
                      .attr("width", w + margin.left + margin.right)
                      .attr("height", h + margin.top + margin.bottom)
                      .attr("fill", "transparent").attr("stroke","grey").attr("stroke-width", "5");
    
    svg.append("g")
        .attr("id", "canvas")
        .attr("transform", "translate(" + margin.left + "," + margin.top + ")")
        .selectAll("rect")
        .data(communities)
        .enter()
        .append("rect")
        .attr("x", function(d, i){
            return d[0];
        })
        .attr("y", function(d, i){
            return d[1];
        })
        .attr("id", function(d, i){
            return "rect_"+i;
        })
        .attr("width", communityWidth).attr("height", communityHeight)
        .attr("fill", "transparent").attr("stroke","cadetblue").attr("stroke-width", "2");
    // if quarantee, draw a small rect for quaranteed place
    // console.log("if quaranteed? "+ifQuaranteed);
    if (ifQuaranteed){
        // svg.append("rect").attr("x", 0).attr("y",  0)
        //    .attr("width", 30).attr("height", 30).attr("id", "rect_quarantee")
        //    .attr("fill", "transparent").attr("stroke","orange").attr("stroke-width", "4")
        //    .attr("transform", "translate(5, 5)");
        drawQuaranteeBox();
    }
}

function drawQuaranteeBox(){
    var svg = d3.select("#smallCanvas");
    svg.append("rect").attr("x", 0).attr("y",  0)
    .attr("width", 30).attr("height", 30).attr("id", "rect_quarantee")
    .attr("fill", "transparent")
    .attr("stroke", "#0275d8").attr("stroke-width", "4")
    .attr("transform", "translate(5, 5)");
}


// Initialize function (initialize agents, community boxes are already initiated!)
function InitAgents(containerId, numS, numI){
    // i.e., community ID
    var svg = d3.select("#canvas");
    var svgRect = svg.select("#rect_"+ containerId);
    
    // Notice agents are global variables.
    for (var i = 0; i < numS; ++i) {
        //                 svg, x, y, id, speed, angle, status, svgRect
        var ag = new Agent(svg, Math.random(), Math.random(), "ag"+idCount,
             0.1 * sliders.numDayPerSecond.value, Math.random()*2*Math.PI, "S", svgRect);
        ag.Draw();
        agents.push(ag);
        idCount++;
    }
    // set initial infected agents
    for (var i = 0; i < numI; ++i) {
        //                 svg, x, y, id, speed, angle, status, svgRect
        var ag = new Agent(svg, Math.random(), Math.random(), "ag"+idCount,
             0.1 * sliders.numDayPerSecond.value, Math.random()*2*Math.PI, "I", svgRect);
        ag.Draw();
        agents.push(ag);
        idCount++;
    }
    return svg;
}


// initialize the simulation time controls (d3 timers)
function initSim() {
    var tc = d3.timer(tickNormal, 300);
    // FIRST number is update frequency, SECOND number is delays
    // 500 for animation time
    var dtc = d3.interval(tickDaily , 1000/sliders.numDayPerSecond.value + 500, 300);
    return [tc, dtc]
}


// write a function for the start/stop simulation button
document.getElementById("playButton").addEventListener("click", onPlay);
function onPlay(){
    if (startStopFlag == 0){ // currently running, need to be paused
        startStopFlag = 1;
        timeControllers[0].stop();
        pausedTime = d3.now();
        dailyCycleTime = pausedTime - lastDailyTime;
        console.log("unfinished cycle length: " + (1000/sliders.numDayPerSecond.value - dailyCycleTime));
        console.log(dailyCycleTime);
        timeControllers[1].stop();
        
        document.querySelector('#playButton').value = 'Resume';
    }
    else if (startStopFlag == 1) {
        startStopFlag = 0;
        stoppageTime = d3.now() - pausedTime; // the time whole simulation stopped
        // compute new simulation resume time
        var newStart = d3.now();
        console.log("d3 time now: " + newStart +"; stoppage duration: " + stoppageTime+
        "; New daily delays: "+(1000/sliders.numDayPerSecond.value - dailyCycleTime));

        timeControllers[0] = d3.timer(tickNormal);
        // it is like after delay time used up, need another 4000 mseconds before first function call!
        timeControllers[1] = d3.interval(tickDaily, 1000/sliders.numDayPerSecond.value + 500, newStart - dailyCycleTime);
        
        document.querySelector('#playButton').value = 'Pause';
    }
}


// write a function for the reset button, 
// which is just restart everything using the current settings in the webpage.
document.getElementById ("resetButton").addEventListener("click", onReset);
function onReset(){
     // // need to stop and restart timers for same starting period!
     for (var i in timeControllers){
        timeControllers[i].stop();
    }

    // reset day counter
    dayCount = 0;
    initCanvas();
    initAgentObj(); // idCount and agents are reset in function initAgentObj()
    console.log("reset at timestamp: "+d3.now());
    // need to reset countsArray, and plot at time 0!
    countsArray = [];
    countsArray.push(new CountStats(agents));
    plotCounts(countsArray);

    // timeControllers = initSim();
    // var tc = d3.timer(tickNormal, 300);
    // // FIRST number is update frequency, SECOND number is delays 500 for animation time
    // var dtc = d3.interval(tickDaily , 1000/sliders.numDayPerSecond.value + 500, 300);
    // timeControllers[0] = tc;
    // timeControllers[1] = dtc;

    var newStart = d3.now();
    timeControllers[0] = d3.timer(tickNormal);
    timeControllers[1] = d3.interval(tickDaily, 1000/sliders.numDayPerSecond.value + 500, newStart);
    startStopFlag = 0; // simulation is running when reset
    document.querySelector('#playButton').value = 'Pause';
}


// Initialize slider responces, record dom in slider variable for access
function onInputSliders(){
    for (var i=0; i<IDs.length; i++){
        const j = parseInt(i);
        var v;

        // console.log('data slider min:' + $("#"+IDs[j]).attr('data-slider-min'));
        const theSlider = $("#"+IDs[j]);
        theSlider.slider({
            formatter: function(value) {
                v = value;
                return 'Current value: ' + value;
            },
            // min: theSlider.attr('data-slider-min'),
            // max: theSlider.attr('data-slider-max'),
            // value: theSlider.attr('data-slider-value'),
            // ticks: [theSlider.attr('data-slider-min'), theSlider.attr('data-slider-max')],
            // ticks_labels: [theSlider.attr('data-slider-min'), theSlider.attr('data-slider-max')],
            // step: theSlider.attr('data-slider-step'),
            // ticks_snap_bounds: (theSlider.attr('data-slider-max')-theSlider.attr('data-slider-min'))/100,
        });
        $("#demo"+parseInt(j+1)+"_min").text(theSlider.attr('data-slider-min'));
        $("#demo"+parseInt(j+1)+"_max").text(theSlider.attr('data-slider-max'));

        // set text value
        // var txtElement = document.getElementById("demo"+Number(i+1));
        var txtElement = $("#demo"+Number(j+1)).get(0);
        // console.log('init slider value is:'+v);
        txtElement.innerHTML = v;
        // on drag the slider
        $("#"+IDs[j]).on("slide", function(slideEvt) {
            $("#demo"+Number(j+1)).text(slideEvt.value);
        });

        sliders[IDs[j]] = document.getElementById(IDs[j]);
        // const sl = document.getElementById(IDs[i]);
        // const txtElement = document.getElementById("demo"+Number(i+1));
        // var ele = txtElement;
        // ele.innerHTML = sl.value; // display init value in text
        // // set update function to range html dom
        // sl.oninput = function(i){
        //     txtElement.innerHTML = this.value;
        // };
        // sliders[IDs[i]] = sl;
    }
    // init check if quaranteed
    ifQuaranteed = $("#checkQ").is(":checked") ? 1 : 0;
    
    $('#checkQ').on('click', function() {
        // update policy parameter for quarantee
        ifQuaranteed = $("#checkQ").is(":checked") ? 1 : 0;
        console.log("Update if quaranteed!!! Now is:"+ifQuaranteed);
        // if clicked, apply quarantee policy instantly (at the end of the day)
        if( ifQuaranteed ) {
            // 1. draw quarantee box
            drawQuaranteeBox();
        } else {
            // if unclicked, destory quarantee box
            d3.select("#rect_quarantee").remove();
            // at the end of the day, all agents will be move back to the community they came from 
        }
        $('#checkQ').val(this.checked);        
    });

}


// set callback update functions
function tickNormal (e) {
    // before update force, clear force to zero
    for (var i = 0; i < agents.length; ++i) {
        var agI = agents[i];
        agI.forceX = 0; agI.forceY = 0;
    }
    // after reset force to zero, update force and infectious status
    for (var i = 0; i < agents.length; ++i) {
        var agI = agents[i];
        for (var j = i+1; j < agents.length; ++j) {
            var agJ = agents[j];
            updateInfect(agI, agJ); // i infect disease to j
            updateInfect(agJ, agI); // j infect disease to i
            updateForceBoth(agI, agJ); // update force
        }
    }
    // after update force, move particles
    for (var i = 0; i < agents.length; ++i) {
        var agI = agents[i];
        if(agI.travel === false){
            // agI.Move();
            agI.forceMove();
        }
    }

    lastEndTime = d3.now();
}


// callback function execute at the end of the day
function tickDaily(e) {
    // step 1: stop simulation
    timeControllers[0].stop();
    // step 2: update agent status (disease status and travel status)
    var pausedT = d3.now();
    for (var i = 0; i < agents.length; ++i) {
        dailyUpdate(agents[i]);
    }
    countsArray.push(new CountStats(agents)); // stats
    plotCounts(countsArray); // plot stats

    var stoppage = d3.now() - pausedT;
    console.log("Daily update rerun at clock time: "+e+"; Stoppage time: "+stoppage+"; Since last update: "+(pausedT-lastDailyTime));

    timeControllers[0] = d3.timer(tickNormal, 500); // delays: let travel (transition animation) finished.
    lastDailyTime = d3.now();
    dayCount = dayCount + 1;
}


var IDs = ["numDayPerSecond",
    "numCommunity", "numSAgent", "numICommunity", "numIAgent",
    "infectRadius", "infectChance", "infectDays",
    "numDaysBeforeQuaranteed", "socialDistance", "travelProb"];


// write a function to initialize agent objects
function initAgentObj(){
    // check if there are plotted agents (length of agents not equal to zero)
    // If so, clear all agents
    console.log("Before re-start, num of agents in last simu is: " + agents.length);
    for (var j in agents){
        console.log("agent i is:"+agents[j]);
        var ag = agents[j];
        ag.wipeOut();
    }
    idCount = 0, agents = []; // reset values

    console.log("suspected agents: "+sliders.numSAgent.value);
    var nSA = Number(sliders.numSAgent["value"]);
    var nIA = Number(sliders.numIAgent["value"]);
    console.log("suspected agents: "+nSA+"; infected agents: "+nIA+";");
    var nC = communities.length;
    var nIC = Number(sliders.numICommunity["value"]);
    console.log("# communities: "+nC+"; infected communities: "+nIC+";");
    console.log("infect radius in initAgentObj: "+sliders.infectRadius["value"]);
    // sampling without replacement by shuffling
    var bucket = d3.shuffle(d3.range(nC));
    for (var i in bucket){
        var tileIndex = bucket[i];
        if (i < nIC){
            InitAgents(tileIndex, nSA, nIA);
        } else {
            InitAgents(tileIndex, nSA, 0);
        }
    }
}


// Start running the program!
onInputSliders(); // init control variables
initCanvas();
initAgentObj();
//var tc, dailyTimeControl; // global time control for every time and every day
// all time counts for default time control
timeControllers = initSim();
countsArray.push(new CountStats(agents)); // get daily summary for day0!
initGraphs();
plotCounts(countsArray);  // plot counts data!

// for (var i=0; i<IDs.length; i++){
//     $("#"+IDs[i]).on("slide", function(slideEvt) {
//         console.log("slide value changed:"+slideEvt.value+"!!!!!");
//         console.log(i);
//         console.log("Demo text id to change:"+parseInt(Number(i)+1));
//         $("#demo"+parseInt(Number(i)+1)).text(slideEvt.value);
//     });
// }