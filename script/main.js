var d3 = require("d3");
var $ = require('jquery');
require('bootstrap-slider');

// declare all gloabal variables in the front
var IDs = ["numDayPerSecond",
    "numCommunity", "numSAgent", "numICommunity", "numIAgent",
    "infectRadius", "infectChance", "infectDays",
    "numDaysBeforeQuaranteed", "socialDistance",
     "travelProb", "localTravelProb"];
var sliders = {};
var startStopFlag = 0; // 0: running; 1: paused 2: stopped
var ifQuaranteed = false; // if apply quaranteed
var ifSocialDistancing = false; // if apply social distancing
var ifTravel = true; // whether travel between different tiles
var ifLocalTravel = true; // whether travel back and forth to centers

// community tiles and agent objects.
var agents = [], idCount = 0;
var communities=[];

// plot dimensions
var margin = {top: 20, right: 50, bottom: 50, left: 50}
margin.width = 500 - margin.left - margin.right;
margin.height = 400 - margin.top - margin.bottom;

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
        this.x = x;
        this.y = y;
        this.id = id;
        this.radius = 3; // ball radius for visual.
        this.speed = speed;
        this.angle = angle;
        this.status = status;
        this.statusTime = dayCount; // the Day 1 of the current disease status (S.I.R.)

        this.data = [this.id]; // allow us to use d3.enter()
        if(status == "S"){
            this.color = '#5cb85c'; // BS success (green)
        } else if (status == "I") {
            this.color = '#d9534f'; // BS danger (red)
        } else {// recovered agents
            this.color = 'grey';
        }
        // compute v_x, v_y
        this.vx = Math.cos(this.angle) * this.speed; // velocity x
        this.vy = Math.sin(this.angle) * this.speed; // velocity y

        // update to true scaled position
        this.svgRect = svgRect; // sibling rectangle of constraints in community
        this.setXY(); // set x and y based on box rect position

        // if quaranteed
        this.quaranteed = false;
        var str = svgRect.attr("id");
        this.home = str.split("_")[1];
        // this.transitioning = false; // to guide local traveling animations movements
        // not traveling to local centers or other community, 
        // it solely works as a lock to prevent calling Move() function.
        this.travel = false;
        this.traveledLocalToday = false; // flag for whether moved to center
    }
    // update to true scaled position
    setXY(){
        var re = this.svgRect;
        var x = re.attr("x"), y = re.attr("y"), w = re.attr("width"), h = re.attr("height");
        this.x = this.x * w + Number(x);
        this.y = this.y * h + Number(y);
        // store box info
        this.boxLeft = x;
        this.boxTop = y;
        this.boxRight = parseInt(x) + parseInt(w);
        this.boxBottom = parseInt(y) + parseInt(h);
    }
    // Future TODO: divide each box to 20 * 20 grids, compute the grid index it falls into for efficiency

    // initialize the DOM
    Draw(){
        var svg = this.svg;
        var ball = svg.selectAll('#'+this.id).data(this.data);
        
        ball.enter()
            .append('circle')
            .attr("r", this.radius)
            .style("fill", this.color)
            .attr("id", this.id)
            .style("stroke", "black")
            .style("stroke-width", "1px");
        ball.attr("cx", this.x)
            .attr("cy", this.y)
            .style("fill", this.color);
    }

    // Step move function
    Move(){
        this.x += this.vx;
        this.y += this.vy;
        // check if hit the frame rectangle for x axis (right)
        if (parseInt(this.boxRight) <= parseInt(this.x) + parseInt(this.radius)) {
            // console.log("hit right");
            this.x = parseInt(this.boxRight) - parseInt(this.radius) - 1;
            this.angle = Math.PI - this.angle;
            this.vx = -this.vx;
        }
        // (left)
        if (parseFloat(this.x) - parseInt(this.radius) < parseInt(this.boxLeft)) {
            // console.log("hit left");
            this.x = parseInt(this.boxLeft) + parseInt(this.radius) + 1;
            this.angle = Math.PI - this.angle;
            this.vx = -this.vx;
        }
        // check if hit the frame rectangle for y axis (bottom)
        if (parseInt(this.boxBottom) < parseFloat(this.y + this.radius)) {
            // console.log("hit bottom");
            this.y = parseInt(this.boxBottom) - parseInt(this.radius) - 1;
            this.angle = 2 * Math.PI - this.angle;
            this.vy = -this.vy;
        }
        // (top)
        if (parseFloat(this.y) - parseFloat(this.radius) < parseInt(this.boxTop)) {
            // console.log("hit top");
            this.y = parseInt(this.boxTop) + parseFloat(this.radius)+1;
            this.angle = 2 * Math.PI - this.angle;
            this.vy = -this.vy;
        }
        // Just left this as sanity check, it should not be run since all angles are between 0-pi
        if (this.angle > 2 * Math.PI){
            this.angle = this.angle - 2 * Math.PI;
        }
        if (this.angle < 0){
            this.angle = 2 * Math.PI + this.angle;
        }
        // Finally, draw updated results!
        this.Draw(); // consider use mass draw for efficiency
    }

    checkRecover(){
        var today = dayCount;
        // If the guy has been sicked for long enough, it "removed" (recovered/died)
        // console.log("The difference is "+(today - this.statusTime));
        if (today - this.statusTime > sliders.infectDays.value && this.status == "I"){
            this.status = "R"; // recovered
            this.color = "grey";
            // this.Draw(); // update color in time for animation
        }
    }

    // agent random traveling function with a small given probability
    // Assumption: travel to random place and come back later
    // ifCN=true for traveling simulation to centers like grocery store.
    moveToCommunity(j, xLeftPixel=20, yTopPixel=20, aniLength=500, ifCN=false){ // j: a number denotes the destination community id.
        // step 0: check if it is in non-home community,
        // if so, travel back to home; Otherwise, travel to proposed community j.
        var currentN = this.svgRect.attr("id").split("_")[1]; // return "quarantee" for quarantee box

        if (!ifCN){
            if (currentN != this.home){
                j = this.home; // set back to home
            } else { // at home!
                if (j == this.home){ // wrongly proposed community to home, should not happen, stop move!
                    return true;
                }
            }
        } else { // if called by gocercy travel, set destination to current id.
            j = currentN;
        }

        // step 1: if quaranteed, don't move; otherwise, move to j.
        if (this.quaranteed){
            return true;
        }

        // step 2: change community information for the agent
        var newSvg = d3.select("#canvas");
        var svgRect = newSvg.select("#rect_"+ j);
        this.svg = newSvg;
        this.svgRect = svgRect;

        var x = svgRect.attr("x"), y = svgRect.attr("y");
        var w = svgRect.attr("width"), h = svgRect.attr("height");
        // set target to the centriod of the new block
        if (ifCN){
            var xCenter = parseFloat(x) + parseFloat(xLeftPixel);
            var yCenter = parseFloat(y) + parseFloat(yTopPixel);
        } else {
            var xCenter = parseFloat(x) + parseFloat(w*0.5);
            var yCenter = parseFloat(y) + parseFloat(h*0.5);
        }

        // step 3: update bounding community box
        if (!ifCN){ // no need to update box if local traveling
            this.boxLeft = x;
            this.boxTop = y;
            this.boxRight = parseInt(x) + parseInt(w);
            this.boxBottom = parseInt(y) + parseInt(h);

            // when local travels, don't update this value 
            // otherwise it breaks up animation
            this.x = xCenter;
            this.y = yCenter;
        }
        var oldX = this.x, oldY = this.y;
        // step 4: transition ball (svg object) to new centriod
        var ball = d3.select('#canvas').select('#'+this.id).data(this.data);
        var thisAgent = this;
        if (!ifCN) {
            ball.transition()
            .duration(aniLength) // 0.5 second animation of traveling
            .attr("cx", xCenter)
            .attr("cy", yCenter);
        } else {
            // if it travels and it is end of the day, just let
            // other transitions (e.g., be quaranteed or travel to other community)
            // overwrite this animation!
            ball.transition()
            .duration(aniLength) // 0.5 second animation of traveling
            .attr("cx", xCenter).attr("cy", yCenter)
            // .on("start", function(){thisAgent.x = oldX; thisAgent.y = oldY;})
            .on("end", function() {
                thisAgent.x = xCenter; thisAgent.y = yCenter;
            })
            .transition()
            .delay(aniLength)
            .duration(aniLength)
            .attr("cx", oldX)
            .attr("cy", oldY)
            // .on("start", function() {thisAgent.transitioning=true; })
            // .on("end", function() { thisAgent.transitioning=false; });
            .on("end", function() {
                // update positions
                thisAgent.x = oldX; thisAgent.y = oldY;
                var newX = thisAgent.x - x;
                // console.log("returned x is "+newX);
            })

        }

    }
    // travel to community centers back and force (especially during social distancing);
    moveToFromLocalCenter() {
        if (this.traveledLocalToday){ // if already locally traveled, break function.
            return false;
        }
        // (j, xLeftPixel=20, yTopPixel=20, aniLength=500, ifCN=false)
        // first assignment j will be overwritten
        this.travel=true; // set up travel lock

        var dayLength = 1000/sliders.numDayPerSecond.value;
        var x = this.svgRect.attr("x"), y = this.svgRect.attr("y");
        var oldX = this.x - x, oldY = this.y - y;
        // console.log("old x is "+oldX);
        //parseInt(dayLength/10)*4
        this.moveToCommunity(0, 5, 5, 200, true);
        // this.hold(parseInt(1000));
        // this.moveToCommunity(0, oldX, oldY, 1000, true);
        // var newX = this.x - x, newY = this.y - y;
        
        this.travel=false;
        this.traveledLocalToday=true; // at most one local travel per day
    }

    // fix the trip at a place for tl milliseconds
    // hold(tl) {
    //     var ball = d3.select('#canvas').select('#'+this.id);
    //     var thisAgent = this;
    //     if (!this.transitioning) { // no unfinished animation left!
    //         ball.transition().duration(tl)
    //         .attr("cx", this.x).attr("cy", this.y).style("fill", this.color)
    //         .on("start", function() { thisAgent.transitioning=true; })
    //         .on("end", function() { thisAgent.transitioning=false; });
    //     }
    // }

    // move to quarantee box
    moveToQuaranteeBox(){
        // step 0. mark agent as quaranteed
        this.quaranteed = true;
        // step 1. select the quarantee box to send
        var newSvg = d3.select("#smallCanvas");
        var svgRect = newSvg.select("#rect_quarantee");
        this.svg = newSvg;
        this.svgRect = svgRect;
        
        var x = svgRect.attr("x")-margin.left+5, y = svgRect.attr("y")-margin.top+5;
        var w = svgRect.attr("width"), h = svgRect.attr("height");
        // set target to the centriod of the new block
        var xCenter = parseFloat(x) + parseFloat(w/2)
        var yCenter = parseFloat(y) + parseFloat(h/2);
        // step 2. update bounding box
        this.boxLeft = x;
        this.boxTop = y;
        this.boxRight = parseInt(x) + parseInt(w);
        this.boxBottom = parseInt(y) + parseInt(h);
        this.x = xCenter;
        this.y = yCenter;
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

    // write a function to reset speed and random travel direction
    resetMotion(){
        // console.log("Motion is reset!!!");
        this.angle = Math.random()*2*Math.PI;
        this.speed = 0.3 * sliders.numDayPerSecond.value;
        this.vx = Math.cos(this.angle) * this.speed; // velocity x
        this.vy = Math.sin(this.angle) * this.speed; // velocity y
    }
}

// write a function to draw all circles at once!
function massDraw(){
    var svg = d3.select("#canvas");
    var ball = svg.selectAll("circle").data(agents);
    
    ball.enter()
        .append('circle')
        .attr("r", function(d){d.radius})
        .style("fill", function(d){d.color})
        .attr("id", function(d){d.id})
        .style("stroke", "black")
        .style("stroke-width", "1px");
    ball.attr("cx", function(d){d.x})
        .attr("cy", function(d){d.y})
        .style("fill", function(d){d.color});
}

// daily updation. e.g., recovered, quaranteed
function dailyUpdate(agent){
    agent.travel = true;
    // step 1. check whether infected agents get recovered.
    agent.checkRecover();
    // step 2. agent needs to travel given conditions:
    // (1) randomly chosen to travel
    // (2) not quaranteed
    if (ifTravel){ // policy agrees to travel
        if ( Math.random() <= sliders.travelProb.value && agent.quaranteed==false ) {
            if (communities.length > 1){ // not move for case with one community
                // move to a random selected community with a probability
                // do NOT move to its own community center!
                var cN = parseInt(Math.random() * (sliders.numCommunity.value-1));
                if (cN >= parseInt(agent.svgRect.attr("id").split("_")[1])){
                    ++cN;
                }
                agent.moveToCommunity(cN); // could overwrite local travels but it is okay
            }
        }
    }

    // step 3. decide whether agent needs to be quaranteed (repeat everyday)
    // If so, send to quaranteed box and freeze its moving abilities
    if (ifQuaranteed){
        // have sick for exact number of days
        if (agent.status=="I" && (dayCount - agent.statusTime) >= sliders.numDaysBeforeQuaranteed.value ){
            // console.log("Quaranteed this agent to the box!");
            agent.moveToQuaranteeBox();
        }
    }
    // step 4. for recovered agent, send it back to there home!
    if (ifQuaranteed){
        // if agent recovered but still quaranteed in box
        if (agent.status=="R" && agent.quaranteed==true){
            agent.quaranteed=false;
            // console.log("Move back to community!!!!");
            agent.moveToCommunity(agent.home);
        }
    }
    // step 5. send quaranteed back to home if no quaranteed policy anymore
    if (!ifQuaranteed){
        if (agent.quaranteed){
            console.log("Qurantee policy canceled! Home is "+agent.home+"id is: "+agent.id);
            agent.quaranteed = false;
            agent.moveToCommunity(agent.home);
        }
    }
    agent.travel = false; // set back travel option (motion lock) after traveling
    // reset local travel parameter for the next day
    agent.traveledLocalToday = false;
}

// Check whether two balls are within infect distance
// ASSUME ball1 is "I", ball2 is "S", decide whether ball 2 is infected
// return true means updated, false means not updated (although returned value is not used for now)
function updateInfect(ball1, ball2) {
    // only if ball1 is I and ball2 is S
    // Also, ball1 is infected for GREATER than 1 day (for realistics and prevent chaining effect!)
    if (ball1.status == "I" && ball2.status == "S" && (dayCount - ball1.statusTime)>=1){
        var absx = Math.abs(parseFloat(ball2.x) - parseFloat(ball1.x));
        var absy = Math.abs(parseFloat(ball2.y) - parseFloat(ball1.y));
        var infectRadius = sliders.infectRadius.value;
        function getMax(a, b){ return (a>b)?a:b; }
        // coarse distance pre-check
        if (getMax(absx, absy) > infectRadius){
            return false;
        }
        // console.log("Infection almost unpreventable for this pair");
        // calculate distance
        var distance = Math.sqrt( (absx*absx) + (absy*absy) );
        // check if distance is less than sum of two radius - if yes, collision
        if (distance < parseFloat(infectRadius)) { // with infectious radius
            ball2.color = "#d9534f"; // BS red
            ball2.status= "I";
            ball2.statusTime = dayCount;
            return true;
        }
        return false;
    }
    return false; // not correct status
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
        // console.log("Suspected: "+this.S+"; Infected: "+this.I+"; Removed: "+this.R+"; All: "+this.total);
    }
}


// initialize plotting elements for stats visualization (update daily)
function initGraphs(){
    // basic dims of the graph
    var width = margin.width, height = margin.height;
    plotElements.timeLength = 5; // init time lengths
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
    plotElements['xScale'] = d3.scaleLinear().domain([0, tl]).range([0, width-50]);
    var svg = plotElements['svg'];
    var xScale = plotElements['xScale'], yScale = plotElements['yScale'];
    svg.append("g").attr("id", "yAxis").call(d3.axisLeft(yScale));
    // console.log("svg IDs are:"+plotElements['svg'].attr("class")+"DRAW HEIGHTS:"+height);
    svg.append("g").attr("id", "xAxis")
                   .attr("transform", "translate(10," + height + ")")
                   .call(d3.axisBottom(xScale));
    plotElements.areaSPlot = svg.append("path").attr("id", "filledSArea");
    plotElements.areaIPlot = svg.append("path").attr("id", "filledIArea");
    plotElements.areaRPlot = svg.append("path").attr("id", "filledRArea");
}

// a function to create/update stats plots
function plotCounts(countsArray){
    // basic dims of the graph
    var width = margin.width, height = margin.height;
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

    var areaSPlot = plotElements.areaSPlot;
    var areaIplot = plotElements.areaIPlot;
    var areaRplot = plotElements.areaRPlot;
    areaIplot.datum(countsArray)
        .attr("fill", "#d9534f") // plot infected area, color is red (danger in bootstrap)
        .attr("stroke", "#69b3a2")
        .attr("stroke-width", 1.5)
        .attr("d", d3.area().x(function(d, i) { return xScale(i) })
                            .y0(function(d, i) { return yScale(0) })
                            .y1(function(d, i) { return yScale(d.I) })
        );
    areaSPlot.datum(countsArray)
        .attr("fill", "#5cb85c") // suspected area, color is green (success in bootstrap)
        .attr("stroke", "#69b3a2")
        .attr("stroke-width", 1.5)
        .attr("d", d3.area().x(function(d, i) { return xScale(i) })
                            .y0(function(d, i) { return yScale(d.I) })
                            .y1(function(d, i) { return yScale(d.S+d.I) })
        );
    areaRplot.datum(countsArray)
        .attr("fill", "grey") // plot removed area, color is grey
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
    var w = 500 - margin.left - margin.right,
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
    if (ifQuaranteed){
        drawQuaranteeBox();
    }
    // if center locations, draw center locations for each community
    if (ifLocalTravel){
        drawLocalCenters();
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

function drawLocalCenters(){
    var svg = d3.select("#smallCanvas").append('g').attr("id", "center_locations");
    var numC = sliders.numCommunity.value;
    var localWidth = 10, localHeights = 10, localMargin = 2;

    svg.append("g")
        .attr("id", "local_center")
        .attr("transform", "translate(" + margin.left + "," + margin.top + ")")
        .selectAll("rect")
        .data(communities)
        .enter()
        .append("rect")
        .attr("x", function(d, i){
            return d[0]+localMargin;
        })
        .attr("y", function(d, i){
            return d[1]+localMargin;
        })
        .attr("id", function(d, i){
            return "rect_lc_"+i;
        })
        .attr("width", localWidth).attr("height", localHeights)
        .attr("fill", "transparent").attr("stroke","orange").attr("stroke-width", "2");
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
             0.3 * sliders.numDayPerSecond.value, Math.random()*2*Math.PI, "S", svgRect);
        ag.Draw();
        agents.push(ag);
        idCount++;
    }
    // set initial infected agents
    for (var i = 0; i < numI; ++i) {
        //                 svg, x, y, id, speed, angle, status, svgRect
        var ag = new Agent(svg, Math.random(), Math.random(), "ag"+idCount,
             0.3 * sliders.numDayPerSecond.value, Math.random()*2*Math.PI, "I", svgRect);
        ag.Draw();
        agents.push(ag);
        idCount++;
    }
    return svg;
}


// initialize the simulation time controls (d3 timers)
function initSim() {
    // init d3 force (for social distancing)
    var repelForce = d3.forceManyBody()
                       .strength(-0.1 * sliders.numDayPerSecond.value * sliders.socialDistance.value)
                       .distanceMax(20).distanceMin(10);
    // sim will automatically started (call on inherently)
    // target > min: this will let social distancing repelling run forever. (unless ordered)
    var simulationSD = d3.forceSimulation(agents).alphaDecay(0.03).force("repelForce",repelForce).alphaMin(0.2).alphaTarget(0.8);
    simulationSD.stop(); // need manually stop social distancing at first
    if (ifSocialDistancing){
        simulationSD.restart();
    } else {
        // reset random motion for all agents
        for (var i = 0; i < agents.length; i++){
            // reset speed and angle after there is no social distancing
            agents[i].resetMotion();
        }
    }

    console.log("Agent's values are: "+ JSON.stringify(agents[0]));
    // draw (init) d3 circles
    // massDraw();

    var dayLength = 1000/sliders.numDayPerSecond.value;
    // var tc = d3.timer(tickNormal, 300);
    var tc = d3.interval(tickNormal, parseInt(dayLength/10), 300);
    // FIRST number is update frequency, SECOND number is delays
    // “+500” for animation time (travel, quarantee update at the end of the day)
    var dtc = d3.interval(tickDaily, parseInt(dayLength) + 500, 300);
    return [tc, dtc, simulationSD]
}


// write a function for the start/stop simulation button
document.getElementById("playButton").addEventListener("click", onPlay);
function onPlay(){
    if (startStopFlag == 0){ // currently running, need to be paused
        startStopFlag = 1;
        pausedTime = d3.now();
        dailyCycleTime = pausedTime - lastDailyTime;
        console.log("unfinished cycle length: " + (1000/sliders.numDayPerSecond.value - dailyCycleTime));
        console.log(dailyCycleTime);
        // stop all controllers
        for (var i in timeControllers){
            timeControllers[i].stop(); // stop social distancing when click pause
        }
        document.querySelector('#playButton').value = 'Resume';
    }
    else if (startStopFlag == 1) { // currently paused, need to start running
        startStopFlag = 0;
        stoppageTime = d3.now() - pausedTime; // the time whole simulation stopped
        // compute new simulation resume time
        var newStart = d3.now();
        console.log("d3 time now: " + newStart +"; stoppage duration: " + stoppageTime+
        "; New daily delays: "+(1000/sliders.numDayPerSecond.value - dailyCycleTime));

        var dayLength = 1000/sliders.numDayPerSecond.value;
        // timeControllers[0] = d3.timer(tickNormal);
        timeControllers[0] = d3.interval(tickNormal, parseInt(dayLength/10), newStart - dailyCycleTime+500);
        // it is like after delay time used up, need another 4000 mseconds before first function call!
        timeControllers[1] = d3.interval(tickDaily, parseInt(dayLength) + 500, newStart - dailyCycleTime);
        // reset random motion for all agents
        if ( !ifSocialDistancing ){
            for (var i = 0; i < agents.length; i++){
                agents[i].resetMotion();
            }
        } else { // start social distancing
            console.log("Restart social distancing!!!");
            timeControllers[2].restart();
        }
        document.querySelector('#playButton').value = 'Pause';
    }
}


// write a function for the reset button, 
// which is just restart everything using the current settings in the webpage.
document.getElementById ("resetButton").addEventListener("click", onReset);
function onReset(){
    // need to stop and restart timers for same starting period!
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

    var newStart = d3.now();
    var dayLength = 1000/sliders.numDayPerSecond.value;
    // timeControllers[0] = d3.timer(tickNormal);
    timeControllers[0] = d3.interval(tickNormal, parseInt(dayLength/10), newStart+500);
    timeControllers[1] = d3.interval(tickDaily, parseInt(dayLength) + 500, newStart);
    startStopFlag = 0; // simulation is running when reset
    document.querySelector('#playButton').value = 'Pause';
}


// Initialize slider responces, record dom in slider variable for access
function onInputSliders(){
    for (var i=0; i<IDs.length; i++){
        const j = parseInt(i);
        var v;

        const theSlider = $("#"+IDs[j]);
        theSlider.slider({
            formatter: function(value) {
                v = value;
                return 'Current value: ' + value;
            }
        });
        $("#demo"+parseInt(j+1)+"_min").text(theSlider.attr('data-slider-min'));
        $("#demo"+parseInt(j+1)+"_max").text(theSlider.attr('data-slider-max'));

        // set text value
        // var txtElement = document.getElementById("demo"+Number(i+1));
        var txtElement = $("#demo"+Number(j+1)).get(0);
        txtElement.innerHTML = v;
        // on drag the slider
        $("#"+IDs[j]).on("slide", function(slideEvt) {
            $("#demo"+Number(j+1)).text(slideEvt.value);
        });

        sliders[IDs[j]] = document.getElementById(IDs[j]);
    }

    // init check if quaranteed, social distance, if cross community traveling
    ifQuaranteed = $("#checkQ").is(":checked") ? 1 : 0;
    ifSocialDistancing = $("#checkSD").is(":checked") ? 1 : 0;
    ifTravel = $("#checkT").is(":checked") ? 0 : 1; // checked <==> don't travel!
    ifLocalTravel = $("#checkLT").is(":checked") ? 1 : 0;
    
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
            // need to send all quaranteed objects to there homes 
            // however, only executed at the end of the day!
        }
        $('#checkQ').val(this.checked);
    });

    $('#checkSD').on('click', function() {
        ifSocialDistancing = $("#checkSD").is(":checked") ? 1 : 0;
        if ( ifSocialDistancing ) {
            console.log("restart social distancing force simulation");
            timeControllers[2].restart();
        } else {
            console.log("stop social distancing force simulation");
            timeControllers[2].stop();
            // reset agent motions
            for (var i = 0; i < agents.length; i++){
                agents[i].resetMotion();
            }
        }
    });

    $('#checkT').on('click', function() {
        ifTravel = $('#checkT').is(":checked") ? 0 : 1;
        // don't need to do anything.
    });

    $("#checkLT").on('click', function(){
        ifLocalTravel = $('#checkLT').is(':checked') ? 1 : 0;
        if ( ifLocalTravel ){
            // draw small boxes as center locations for each center
            d3.select("#local_center");
            drawLocalCenters();
        } else {
            // delete center locations
            d3.select("#local_center").remove(); // remove a whole group
        }
    });
}


// set callback update functions
// this function called 10 times in one simulation day!
function tickNormal (e) {
    // console.log("tickNormal called at elapsed time "+e+"; now the time is: "+d3.now());
    // update infect, check 10 times a simulation day.
    for (var i = 0; i < agents.length; ++i) {
        var agI = agents[i], idI = agI.svgRect.attr("id");
        for (var j = i+1; j < agents.length; ++j) {
            var agJ = agents[j], idJ = agJ.svgRect.attr("id");
            if (idI == idJ){ // only those within one community can interact
                if (Math.random() < sliders.infectChance.value){
                    updateInfect(agI, agJ); // i infect disease to j
                    updateInfect(agJ, agI); // j infect disease to i
                }
            }
        }
    }
    // after assessing infect, move particles
    for (var i = 0; i < agents.length; ++i) {
        var agI = agents[i];
        if (ifLocalTravel){
            if (Math.random() < sliders.localTravelProb.value && agI.traveledLocalToday == false){
                agI.moveToFromLocalCenter();
            }
        }
        // whether normal traveling or local traveling
        if(agI.travel == false){
            agI.Move();
        }
    }
    lastEndTime = d3.now();
}


// callback function execute at the end of the day
function tickDaily(e) {
    // step 1: when apply daily summary function, stop the continous time controller
    timeControllers[0].stop();
    // step 2: update agent status:
    // (1) travel (i.e., to other commmunity, go to/back from quarantee box)
    // (2) check disease status (whether recovered)
    var pausedT = d3.now();
    for (var i = 0; i < agents.length; ++i) {
        dailyUpdate(agents[i]);
    }
    countsArray.push(new CountStats(agents)); // stats
    plotCounts(countsArray); // plot stats

    var stoppage = d3.now() - pausedT;
    console.log("Daily update rerun at clock time: "+e+"; Stoppage time: "+stoppage+"; Since last update: "+(pausedT-lastDailyTime));

    // delays: let travel animation to be finished.
    var dayLength = 1000/sliders.numDayPerSecond.value;
    // timeControllers[0] = d3.timer(tickNormal, 500);
    // console.log("the d3 time now before restart normal controller is: "+d3.now());
    timeControllers[0] = d3.interval(tickNormal, parseInt(dayLength/10), d3.now()+500);

    lastDailyTime = d3.now();
    dayCount = dayCount + 1;
}


// Initialize agent objects by initailization sliders conditions
function initAgentObj(){
    // check if there are plotted agents (length of agents not equal to zero)
    // If so, clear all agents
    // console.log("Before re-start, num of agents in last simu is: " + agents.length);
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