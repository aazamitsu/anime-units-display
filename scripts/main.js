const MAP_DEFAULT = 0;
const MAP_SUMMER = 1;
const MAP_WINTER = 2;

const SUMMER_MIN_TYPES = 4;
const WINTER_MIN_TYPES = 2;

let textures = {};
let lastType = undefined;
let fade = 0;
let squish = 0;
let reloads = [];
let lastTex = undefined;
let hintLabel = undefined;
let hasUnit = false
let playedLines = new ObjectSet();

let coldFloors = new Seq();
let summerFloors = new Seq();
let waterFloors = new Seq();
let mapType = MAP_DEFAULT;

function loadTex(name, defValue){
    let file = Vars.tree.get("chibis/" + name + ".png");
    if(file.exists()){
        let tex = new Texture(file, true);
        tex.setFilter(Texture.TextureFilter.mipMapLinearLinear, Texture.TextureFilter.linear);
        return tex;
    }
    return defValue;
}

function loadAll(name){
    let mainTex = loadTex(name);
    if(mainTex){
        return {
            main: mainTex,
            mining: loadTex(name + "-mining", mainTex),
            building: loadTex(name + "-building", mainTex),
            shooting: loadTex(name + "-shooting", mainTex),
        };
    }
}

function getData(data){
    return (mapType == MAP_SUMMER ? data.summer :
           mapType == MAP_WINTER ? data.winter :
           data.def) || data.def;
}

function fetchText(hint){
    let text = Vars.mobile && Core.bundle.has("animehint." + hint.name() + ".mobile") ? 
        Core.bundle.get("animehint." + hint.name() + ".mobile") : 
        Core.bundle.get("animehint." + hint.name(), "");

    if(text == "") return hint.text();
    if(!Vars.mobile) text = text.replace("tap", "click").replace("Tap", "Click");
    return text;
}

function showKey(textName, delay, once, duration){
    if(Vars.player.dead()) return;
    let key = "dialogue." + Vars.player.unit().type.name + "." + textName;
    if(Core.bundle.has(key) && (!once || playedLines.add(key))){
        Time.runTask(delay || 0, () => {
            showDialogue(Core.bundle.get(key), duration || 4);
        });
    }
}

//TODO: スキップするのはどうするか
function showDialogue(text, duration){
    hintLabel.actions(Actions.parallel(Actions.alpha(0, 1.0, Interp.smooth), Actions.translateBy(0, Scl.scl(-50), 1.0, Interp.swingIn)), Actions.hide());

    if(text){
        hintLabel.clearActions();
        hintLabel.visible = true;
        hintLabel.color.a = 1;
        hintLabel.translation.y = 0;
        Vars.ui.hudGroup.addChildAt(1, hintLabel);
        hintLabel.restart("{ease}" + text);

        if(duration){
            hintLabel.actions(Actions.delay(duration), Actions.run(() => {
                hintLabel.actions(Actions.parallel(Actions.alpha(0, 1.0, Interp.smooth), Actions.translateBy(0, Scl.scl(-50), 1.0, Interp.swingIn)), Actions.hide());
            }));
        }
    }
}

Events.run(WorldLoadEvent, e => {
    mapType = MAP_DEFAULT;

    let summerPresent = summerFloors.count(f => Vars.indexer.isBlockPresent(f));
    let coldPresent = coldFloors.count(f => Vars.indexer.isBlockPresent(f));

    //TODO: aside from weather, consider other indcators for summer -rushie
    if(!Vars.state.rules.weather.contains(w => w.weather == Weathers.rain)) summerPresent ++;
    if(Vars.state.rules.weather.contains(w => w.weather == Weathers.sandstorm)) summerPresent ++;
    if(Vars.state.rules.weather.contains(w => w.weather == Weathers.snow)) coldPresent ++;

    if(coldPresent == 0){
        let hasWater = false;

        for(var i = 0; i < waterFloors.size && summerPresent < SUMMER_MIN_TYPES; i ++) {
            if(!Vars.indexer.isBlockPresent(waterFloors.get(i))) continue;
            hasWater = true;
            //count any shallow watter thats based on a summer tile
            if(waterFloors.get(i) instanceof ShallowLiquid && summerFloors.contains(waterFloors.get(i).floorBase)) summerPresent++;
            if(waterFloors.get(i).drownTime > 0) summerPresent++;
        }

        //Summer
        if(hasWater && summerPresent >= SUMMER_MIN_TYPES) mapType = MAP_SUMMER;
    }else if(coldPresent >= WINTER_MIN_TYPES){
        //Winter (set if at least 3 "cold" tiles are present
        mapType = MAP_WINTER;
    }
});

Events.on(UnitControlEvent, e => {
    if(e.player == Vars.player){
        showKey("control", 50, true, 4);
    }
});

Events.on(PayloadDropEvent, e => {
    if(e.carrier == Vars.player.unit()){
        showKey("drop", 50, true, 4);
    }
});

Events.on(PickupEvent, e => {
    if(e.carrier == Vars.player.unit()){
        showKey("pickup", 0, true, 3);
    }
});

Events.run(ClientLoadEvent, e => {
    Seq.withArrays(Vars.content.units(), Vars.content.blocks().select(b => b instanceof Turret || b == Blocks.router))
        .each(u => {
            let main = loadAll(u.name);
            if(main){
                textures[u] = {
                    def: main,
                    summer: loadAll(u.name + "-summer"),
                    winter: loadAll(u.name + "-winter")
                };
            }
    });

    Vars.content.blocks().each(u => {
        if(!(u instanceof Floor)) return;
        if(u.itemDrop == Items.sand) summerFloors.add(u);
        if(u.liquidDrop == Liquids.water) waterFloors.add(u);
        if(u.name.includes("ice") || u.name.includes("snow") || u.name.includes("icy")) coldFloors.add(u);
    });

    let config = {}
    config[UnitTypes.zenith] = {
        anchor: false
    }

    let hints = Reflect.get(Vars.ui.hints, "group");
    let lastHint;
    hintLabel = new FLabel("");
    hintLabel.setStyle(Styles.outlineLabel);
    hintLabel.setAlignment(Align.center, Align.left);
    hintLabel.setWrap(true);

    let elem = extend(Element, {
        draw(){
            hasUnit = false;
            let width = Math.min(Scl.scl(300), Core.graphics.getWidth()/2);
            if(!Vars.player.dead()){
                let next = Vars.player.unit().type;
                if(next == UnitTypes.block){
                    next = Vars.player.unit().tile().block;
                }
                if(lastType != next){
                    fade = Mathf.approachDelta(fade, 0, 0.04);
                    if(fade <= 0.01){
                        lastType = next;
                        reloads = Array(Vars.player.unit().mounts.length);
                        squish = 1;
                    }
                }else{
                    fade = Mathf.approachDelta(fade, 1, 0.04);
                }

                if(reloads.length == Vars.player.unit().mounts.length){
                    for(var i = 0; i < reloads.length; i ++){
                        let val = Vars.player.unit().mounts[i].reload;
                        if(reloads[i] < val){
                            squish = 0.4;
                        }
                        reloads[i] = val;
                    }
                }
            }else{
                fade = Mathf.approachDelta(fade, 0, 0.04);
            }

            let mainData = textures[lastType];

            if(lastType && mainData && Vars.state.isGame()){
                hasUnit = true;

                let data = getData(mainData);
                let unit = Vars.player.unit();

                let mainTex =
                    Vars.player.dead() ? data.main :
                    (
                        unit.mining() ? data.mining :
                        unit.activelyBuilding() ? data.building :
                        unit.isShooting ? data.shooting :
                        data.main
                    );

                if(lastTex != mainTex){
                    squish = Math.max(squish, 0.5);
                    lastTex = mainTex;
                }

                let conf = config[lastType] || {}
                let anchor = (conf.anchor === undefined ? true : conf.anchor)
                let tex = Draw.wrap(mainTex);
                let fin = Interp.swingOut.apply(fade);
                let height = width * tex.height / tex.width;
                let squishFactor = 0.2 * squish + Mathf.sin(Time.globalTime, 20, 0.01);
                let floatScl = 50, floatMag = 8;
                let ox = Mathf.sin(Time.globalTime, 100, floatMag * 0.25), oy = Mathf.cos(Time.globalTime + 5, floatScl, floatMag) - height * 0.02;

                let fwidth = width * (1 + squishFactor)
                let fheight = height * (1 - squishFactor);

                Draw.color();
                Draw.rect(tex, width/2 + ox, Math.min(-height * (1.0 - fin) + height/2 + oy - 1, anchor ? fheight/2 : -1000.0), fwidth, fheight);

                let pad = Scl.scl(12);
                hintLabel.setBounds(pad/2, height + oy, width-pad*2, 0)
            }

            squish = Mathf.approachDelta(squish, 0, 0.05);
        }
    });
    elem.update(() => {
        hints.getChildren().each(group => {
            if(group.getChildren().size > 1){
                group.getChildren().get(0).visible = !hasUnit;
            }
        });
        if(hasUnit && !hintLabel.visible){
            hintLabel.restart();
        }
        hintLabel.visible = hasUnit;

        let nextHint = Reflect.get(Vars.ui.hints, "current");
        if(nextHint != lastHint){
            lastHint = nextHint;
            hintLabel.actions(Actions.parallel(Actions.show(), Actions.alpha(0, 1.0, Interp.smooth), Actions.translateBy(0, Scl.scl(-500), 0.6, Interp.swingIn)), Actions.hide());

            if(nextHint != null){
                showDialogue(fetchText(nextHint));
            }
        }
    });
    elem.touchable = Touchable.disabled;
    Core.app.post(() => Vars.ui.hudGroup.addChildAt(0, elem));
})
