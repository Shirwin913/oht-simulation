// Shared photo-based travel mechanism. Dimensions are illustrative, not measured equipment data.
const OHT_TRAVEL = Object.freeze({ scale:.52, base:-.122, wheelRadius:.205*.52,
  railTop:.302, railInside:.284, guideStart:.65, guideLength:1.30, guideMargin:.15 });
const OHTTravelModel = (() => {
 const T=THREE;
 const material=(color,metalness,roughness)=>new T.MeshStandardMaterial({color,metalness,roughness});
 const metal=material(0xabb2b8,.50,.42),dark=material(0x24272c,.20,.55),rubber=material(0xe4dfcb,0,.70),hub=material(0xb9c1c7,.65,.27),wire=material(0x202328,0,.8);
 function mesh(parent,geo,mat,x=0,y=0,z=0){const o=new T.Mesh(geo,mat);o.position.set(x,y,z);parent.add(o);return o}
 const box=(p,w,h,d,m,x=0,y=0,z=0)=>mesh(p,new T.BoxGeometry(w,h,d),m,x,y,z);
 function beam(p,a,b,w,d,m){const va=new T.Vector3(...a),vb=new T.Vector3(...b),o=box(p,w,va.distanceTo(vb),d,m);o.position.copy(va).add(vb).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),vb.sub(va).normalize());return o}
 function bolt(p,x,y,z,axis='y'){
  const group=new T.Group();group.position.set(x,y,z);p.add(group);if(axis==='z')group.rotation.x=Math.PI/2;if(axis==='x')group.rotation.z=Math.PI/2;
  mesh(group,new T.CylinderGeometry(.018,.018,.003,24),hub);
  const shape=new T.Shape();shape.absarc(0,0,.013,0,Math.PI*2,false);const hole=new T.Path();for(let i=0;i<6;i++){const a=-i*Math.PI/3;const x=Math.cos(a)*.006,z=Math.sin(a)*.006;i?hole.lineTo(x,z):hole.moveTo(x,z)}hole.closePath();shape.holes.push(hole);
  const geo=new T.ExtrudeGeometry(shape,{depth:.011,bevelEnabled:true,bevelSize:.001,bevelThickness:.001,bevelSegments:1,curveSegments:12});geo.rotateX(-Math.PI/2);mesh(group,geo,hub,0,.001,0);
 }
 function plate(p,points,depth,x,y,z){const shape=new T.Shape();points.forEach(([a,b],i)=>i?shape.lineTo(a,b):shape.moveTo(a,b));shape.closePath();const geo=new T.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:.004,bevelThickness:.003,bevelSegments:2});return mesh(p,geo,metal,x,y,z)}
 function cable(p,points,r=.005){const curve=new T.CatmullRomCurve3(points.map(v=>new T.Vector3(...v)));return mesh(p,new T.TubeGeometry(curve,28,r,8,false),wire)}
 function wheel(p,r,width,x,y,z,axis,role){const group=new T.Group();group.position.set(x,y,z);p.add(group);if(axis==='x')group.rotation.z=Math.PI/2;
  const tire=[new T.Vector2(0,-width/2)];for(let j=0;j<=6;j++){const a=j*Math.PI/12;tire.push(new T.Vector2(r*.91+r*.09*Math.sin(a),-width/2+width*.12*(1-Math.cos(a))))}tire.push(new T.Vector2(r,width*.38));for(let j=6;j>=0;j--){const a=j*Math.PI/12;tire.push(new T.Vector2(r*.91+r*.09*Math.sin(a),width/2-width*.12*(1-Math.cos(a))))}
  tire.push(new T.Vector2(0,width/2));
  mesh(group,new T.LatheGeometry(tire,56),rubber);
  for(const sign of [-1,1]){
   // Shallow dished metal insert, recessed bearing and flush solid axle cap.
   const dish=[new T.Vector2(r*.36,-.006),new T.Vector2(r*.48,-.006),new T.Vector2(r*.68,.002),new T.Vector2(r*.70,.008),new T.Vector2(r*.56,.008),new T.Vector2(r*.42,-.001),new T.Vector2(r*.36,-.001)];
   const insert=mesh(group,new T.LatheGeometry(dish,56),hub,0,sign*(width/2-.002),0);if(sign<0)insert.rotation.x=Math.PI;
   mesh(group,new T.CylinderGeometry(r*.37,r*.37,.008,40),dark,0,sign*(width/2-.003),0);
   mesh(group,new T.CylinderGeometry(r*.28,r*.28,.010,32),metal,0,sign*(width/2+.002),0);
  }
  for(const sign of [-1,1]){
   for(const rr of [.43,.57]){const race=mesh(group,new T.TorusGeometry(r*rr,r*.018,8,48),hub,0,sign*(width/2+.008),0);race.rotation.x=Math.PI/2}
   for(let i=0;i<8;i++){const a=i*Math.PI/4;mesh(group,new T.SphereGeometry(r*.055,8,6),hub,Math.cos(a)*r*.48,sign*(width/2+.008),Math.sin(a)*r*.48)}
  }
  if(axis==='x'||role){
   // Axle orientation stays fixed; only the inner rotor spins around its local axle.
   // 走行輪（有動力）、下導輪（沒動力，貼著軌道下緣被帶著轉）、換手輪（碰到導軌才轉）都各自可以轉
   const rotor=new T.Group();rotor.userData.role=role||'travelWheel';rotor.userData.r=r;rotor.userData.side=Math.sign(x)||1;
   for(const child of [...group.children])rotor.add(child);
   group.add(rotor);
  }
  return group;
 }
 const all=new T.Group();const carriers=[],units=[],rail=new T.Group();
 function unit(z){const u=new T.Group();u.position.z=z;all.add(u);units.push(u);
  // Bearing frame and hollow base with mounting screws.
  for(const x of [-.35,.35])box(u,.07,.065,.65,metal,x,.08,0);
  for(const zz of [-.29,.29]){box(u,.77,.065,.06,metal,0,.08,zz);for(const x of [-.31,0,.31])bolt(u,x,.12,zz)}
  // Central drive motor points along travel direction; it remains fixed during switching.
  const motor=mesh(u,new T.CylinderGeometry(.13,.13,.34,32),dark,0,.26,-.10);motor.rotation.x=Math.PI/2;
  const flange=mesh(u,new T.CylinderGeometry(.15,.15,.05,32),metal,0,.26,.08);flange.rotation.x=Math.PI/2;
  box(u,.17,.15,.13,dark,0,.26,-.30);
  // End cap, terminal connector, machined gearbox and front mounting plate.
  for(const zz of [-.275,.085]){const cap=mesh(u,new T.CylinderGeometry(.137,.137,.018,48),dark,0,.26,zz);cap.rotation.x=Math.PI/2}
  box(u,.235,.23,.055,metal,0,.26,-.205);
  for(const x of [-.092,.092])for(const y of [.17,.35])bolt(u,x,y,-.239,'z');
  const gear=mesh(u,new T.CylinderGeometry(.142,.142,.21,48),metal,0,.26,.18);gear.rotation.x=Math.PI/2;
  const band=mesh(u,new T.CylinderGeometry(.145,.145,.025,48),hub,0,.26,.11);band.rotation.x=Math.PI/2;
  // Smooth black motor cover with a cast square flange, as seen in the end-on photo.
  const frontCover=mesh(u,new T.CylinderGeometry(.145,.145,.065,64),dark,0,.25,.31);frontCover.rotation.x=Math.PI/2;
  plate(u,[[-.15,-.15],[.15,-.15],[.17,-.12],[.17,.12],[.14,.15],[-.14,.15],[-.17,.12],[-.17,-.12]],.025,0,.26,.245);
  for(const x of [-.127,.127])for(const yy of [.135,.365])bolt(u,x,yy,.283,'z');
  const shaft=mesh(u,new T.CylinderGeometry(.035,.035,.66,32),hub,0,.205+(.002/.52),0);shaft.rotation.z=Math.PI/2;
  for(const side of [-1,1]){const collar=mesh(u,new T.CylinderGeometry(.060,.060,.06,32),dark,side*.24,.205+(.002/.52),0);collar.rotation.z=Math.PI/2;}
  box(u,.065,.13,.07,metal,.155,.22,.30);
  for(let j=0;j<4;j++)box(u,.010,.008,.064,dark,.192,.175+j*.026,.30);
  box(u,.06,.105,.04,metal,.13,.25,-.30);for(const yy of [.22,.28])box(u,.009,.006,.045,dark,.164,yy,-.30);
  // Photo-visible central upright supports; no assumed motor or internal linkage.
  for(const zz of [-.20,.20]){
   // Continuous support from the fixed frame to the central upright; no floating bracket.
   box(u,.13,.027,.085,metal,0,.413,zz);
   box(u,.072,.073,.046,metal,0,.461,zz);
   for(const xx of [-.043,.043])bolt(u,xx,.431,zz);
   for(const side of [-1,1])beam(u,[side*.055,.425,zz],[side*.020,.520,zz],.018,.022,metal);
   box(u,.045,.13,.035,metal,0,.560,zz);
   box(u,.075,.022,.055,metal,0,.625,zz);
   for(const yy of [.52,.56,.60])bolt(u,0,yy,zz+(zz>0?.022:-.022),'z');
  }
  plate(u,[[-.36,.09],[-.36,.36],[-.28,.40],[.28,.40],[.36,.36],[.36,.09],[.30,.09],[.30,.33],[-.30,.33],[-.30,.09]],.022,0,0,-.265);
  for(const x of [-.32,-.19,.19,.32])bolt(u,x,.36,-.273,'z');
  for(const side of [-1,1]){
   box(u,.08,.25,.46,metal,side*.31,.22,0);
   // Stepped machined side pillars and their outer retaining plates.
   const pillarPoints=side>0?[[.255,.08],[.365,.08],[.365,.35],[.34,.38],[.30,.38],[.30,.31],[.255,.31]]:[[-.365,.08],[-.255,.08],[-.255,.31],[-.30,.31],[-.30,.38],[-.34,.38],[-.365,.35]];
   plate(u,pillarPoints,.06,0,0,.205);
   box(u,.023,.18,.11,hub,side*.37,.29,.205);
   for(const yy of [.20,.27,.34])bolt(u,side*.382,yy,.205,'x');
   wheel(u,.205,.09,side*.44,.205+(.002/.52),0,'x');
   // Lower guide contacts the inner vertical edge of the bottom flange: .46-.25/2=.335.
   for(const guideZ of [-.21,.21]){
    wheel(u,.102,.065,side*(.335-.102),-.025,guideZ,'y','lowerGuide');
    box(u,.17,.026,.075,metal,side*.28,.035,guideZ);
    mesh(u,new T.CylinderGeometry(.025,.025,.045,24),hub,side*.233,.032,guideZ);
    bolt(u,side*.233,.064,guideZ);
   }
   plate(u,[[0,0],[.085,0],[.085,.20],[.04,.24],[0,.24]],.045,side>0?.28:-.365,.10,-.12);
   // Two parallel sloping linear rails per side, fixed to the central assembly.
   // Low, machined mountain saddle, with its center raised and outer ends supported.
   const outline=side>0?[[.065,.365],[.385,.365],[.385,.400],[.095,.598],[.065,.598]]:[[-.385,.365],[-.065,.365],[-.065,.598],[-.095,.598],[-.385,.400]];
   // Solid saddle below the sloping rails, not two disconnected hollow side plates.
   plate(u,outline,.408,0,0,-.204);
   for(const zz of [-.195,.195]){
    for(const xx of [side*.115,side*.31])bolt(u,xx,.38,zz+(zz>0?.014:-.014),'z');
   }
   box(u,.035,.045,.46,metal,side*.345,.350,0);
   for(const zz of [-.195,.195]){
    box(u,.045,.020,.065,metal,side*.34,.326,zz);
    bolt(u,side*.36,.405,zz);
   }
   for(const zz of [-.16,.16]){
    beam(u,[side*.09,.5913,zz],[side*.44,.4223,zz],.055,.043,metal);
    beam(u,[side*.09,.6043,zz],[side*.44,.4353,zz],.018,.048,hub);
    // Parallel bearing tracks and dark center channel, rather than a single solid bar.
    for(const dz of [-.019,.019])beam(u,[side*.09,.6093,zz+dz],[side*.44,.4403,zz+dz],.009,.007,hub);
    beam(u,[side*.09,.6103,zz],[side*.44,.4413,zz],.005,.009,dark);
    for(let i=0;i<4;i++){const a=i/3;bolt(u,side*(.105+.24*a),.602-.16*a,zz)}

   }
   const carrier=new T.Group();u.add(carrier);carrier.userData.role="carrier";carrier.userData.side=side;carriers.push({group:carrier,side});
   // One long machined carrier supports both wheels, with a relieved center web.
   for(const xx of [-.048,.048])box(carrier,.025,.045,.48,metal,xx,-.055,0);
   for(const zz of [-.205,0,.205])box(carrier,.12,.045,.046,metal,0,-.055,zz);
   for(const zz of [-.145,.145])box(carrier,.12,.026,.112,metal,0,-.046,zz);
   box(carrier,.052,.035,.10,metal,0,-.058,0);
   for(const zz of [-.04,.04])bolt(carrier,0,-.036,zz);
   for(const zz of [-.145,.145]){box(carrier,.045,.030,.10,metal,0,-.038,zz);mesh(carrier,new T.CylinderGeometry(.022,.022,.082,24),hub,0,-.004,zz)}
   for(const zz of [-.145,.145]){
    box(carrier,.095,.055,.105,metal,0,-.022,zz);
    for(const xx of [-.030,.030])bolt(carrier,xx,-.038,zz-.036);
    wheel(carrier,.118,.090,0,.065,zz,'y','handWheel');
    for(const sideEdge of [-1,1]){
     plate(carrier,[[0,-.065],[.025,-.065],[.025,-.012],[0,-.035]],.012,sideEdge>0?.034:-.059,0,zz-.028);
    }
    const washer=mesh(carrier,new T.CylinderGeometry(.030,.030,.008,32),hub,0,-.045,zz);
    for(const xx of [-.031,.031])bolt(carrier,xx,-.048,zz+.035);
   }
   for(const zz of [-.145,.145]){
    const slider=box(carrier,.065,.058,.10,hub,0,-.088,zz);slider.rotation.z=side*Math.atan(.29/.14);
    for(const zoff of [-.039,.039]){const seal=box(carrier,.071,.06,.009,dark,0,-.088,zz+zoff);seal.rotation.z=side*Math.atan(.29/.14)}
    for(const xx of [-.038,.038])bolt(carrier,xx,-.027,zz);
   }
   // Limit sensor and cable gland, fixed alongside each mountain slide.
   for(const zz of [-.25,.25]){
    box(u,.033,.065,.025,dark,side*.30,.37,zz);
    box(u,.05,.012,.04,metal,side*.30,.332,zz);bolt(u,side*.30,.345,zz);
    cable(u,[[side*.30,.37,zz],[side*.27,.39,zz-.035],[side*.22,.36,-.27],[side*.10,.36,-.29]]);
   }
   for(const zz of [-.24,.24]){box(u,.055,.08,.055,metal,side*.34,.32,zz);bolt(u,side*.34,.37,zz)}
   // Cable loop on fixed support, without implying an unconfirmed transmission.
   const curve=new T.CatmullRomCurve3([new T.Vector3(side*.31,.28,-.24),new T.Vector3(side*.23,.35,-.30),new T.Vector3(side*.13,.34,-.27),new T.Vector3(side*.19,.29,-.20)]);
   mesh(u,new T.TubeGeometry(curve,16,.007,6,false),wire);
  }
  mesh(u,new T.CylinderGeometry(.10,.10,.15,24),metal,0,-.075,0);
  for(const yy of [-.014,-.13])mesh(u,new T.CylinderGeometry(.12,.12,.018,32),hub,0,yy,0);
  // Exterior of the bogie/body swivel connection; internal bearing layout is schematic.
  const pivotShell=new T.Shape();pivotShell.moveTo(-.105,-.095);pivotShell.lineTo(.105,-.095);pivotShell.lineTo(.12,-.075);pivotShell.lineTo(.12,.075);pivotShell.lineTo(.105,.095);pivotShell.lineTo(-.105,.095);pivotShell.lineTo(-.12,.075);pivotShell.lineTo(-.12,-.075);pivotShell.closePath();
  const housing=new T.ExtrudeGeometry(pivotShell,{depth:.11,bevelEnabled:true,bevelSize:.003,bevelThickness:.003,bevelSegments:2});housing.rotateX(Math.PI/2);mesh(u,housing,metal,0,-.035,0);
  for(const yy of [-.023,-.126]){
   mesh(u,new T.CylinderGeometry(.111,.111,.006,48),dark,0,yy,0);
   mesh(u,new T.CylinderGeometry(.123,.123,.009,48),hub,0,yy-.007,0);
  }
  for(let i=0;i<8;i++){const a=i*Math.PI/4;bolt(u,Math.cos(a)*.098,-.005,Math.sin(a)*.098)}
  // 回轉軸承以下（底座板、螺栓、補強三角板、往下接車廂的連接座）是固定在車身上的：台車轉彎時它不跟著轉。
  // 放在自己的 group（role 'bodyMount'），create() 之後用 mountYaw() 把它轉回車身的方向。
  const mg=new T.Group();mg.userData.role='bodyMount';u.add(mg);
  // Chamfered mounting plate, below the guide wheels rather than across their tires.
  const mount=new T.Shape();for(const [i,v]of [[-.21,-.225],[.21,-.225],[.225,-.21],[.225,.21],[.21,.225],[-.21,.225],[-.225,.21],[-.225,-.21]].entries())i?mount.lineTo(...v):mount.moveTo(...v);mount.closePath();
  const mountGeo=new T.ExtrudeGeometry(mount,{depth:.028,bevelEnabled:true,bevelSize:.004,bevelThickness:.003,bevelSegments:2});mountGeo.rotateX(-Math.PI/2);mesh(mg,mountGeo,metal,0,-.195,0);
  box(mg,.20,.018,.23,hub,0,-.157,0);
  for(const xx of [-.15,.15])for(const zz of [-.15,.15]){
   bolt(mg,xx,-.155,zz);
   mesh(mg,new T.CylinderGeometry(.018,.018,.012,6),hub,xx,-.206,zz);
  }
  // 補強三角板（加強肋）：直角邊貼著中間的軸承座，斜邊往外、往下接到底座板（四片都朝外）
  [0,Math.PI/2,Math.PI,-Math.PI/2].forEach(a=>{
   const g=plate(mg,[[0,-.157],[.080,-.157],[0,-.083]],.016,0,0,0);g.geometry.translate(0,0,-.008);
   g.rotation.y=a;g.position.set(.10*Math.cos(a),0,-.10*Math.sin(a));
  });
  // Continuous load path: frame cross-member -> pivot -> plate -> neck -> yoke.
  box(u,.33,.045,.20,metal,0,.065,0);
  mesh(u,new T.CylinderGeometry(.105,.105,.07,32),metal,0,.015,0);
  mesh(mg,new T.CylinderGeometry(.103,.103,.035,32),metal,0,-.152,0);
  box(mg,.25,.105,.25,metal,0,-.242,0);
  for(const xx of [-.16,.16])box(mg,.075,.14,.32,metal,xx,-.292,0);
  for(const zz of [-.13,.13])box(mg,.395,.045,.075,metal,0,-.352,zz);
  for(const xx of [-.16,.16])for(const zz of [-.10,.10])bolt(mg,xx,-.253,zz);
  // Bundled harness follows the upper cross member with loops near the drive unit.
  for(let i=0;i<4;i++)cable(u,[[-.31,.39+i*.006,-.28],[-.18,.37+i*.006,-.29],[0,.375+i*.006,-.28],[.18,.37+i*.006,-.29],[.31,.39+i*.006,-.28]],.0035);
  for(const x of [-.24,.24])box(u,.013,.035,.027,dark,x,.38,-.28);
  // Small retainers keep the cable bundle attached to the cross member.
  for(const xx of [-.28,-.12,.12,.28]){
   box(u,.014,.037,.024,dark,xx,.426,.245);
   box(u,.035,.012,.031,metal,xx,.397,.245);
   bolt(u,xx,.407,.23);
  }
  for(const side of [-1,1]){
   const bearing=mesh(u,new T.CylinderGeometry(.056,.056,.022,40),hub,side*.32,.205+(.002/.52),0);bearing.rotation.z=Math.PI/2;
   for(const zz of [-.034,.034])for(const yy of [.175,.243])bolt(u,side*.368,yy,zz,'x');
   box(u,.015,.13,.085,hub,side*.37,.225,.20);
   for(const yy of [.18,.235,.29])bolt(u,side*.382,yy,.20,'x');
  }
  // End-on harness, looped service leads and pale identification sleeves.
  for(let i=0;i<3;i++)cable(u,[[-.31,.40+i*.006,.245],[-.21,.414+i*.006,.25],[0,.42+i*.006,.245],[.21,.414+i*.006,.25],[.31,.40+i*.006,.245]],.0035);
  for(const side of [-1,1]){
   cable(u,[[side*.30,.40,.245],[side*.22,.45,.27],[side*.18,.42,.29],[side*.20,.36,.28],[side*.27,.37,.25]],.005);
   const sleeve=mesh(u,new T.CylinderGeometry(.010,.010,.075,20),rubber,side*.24,.417,.25);sleeve.rotation.z=Math.PI/2;
   box(u,.024,.05,.024,dark,side*.32,.423,.245);
   plate(u,[[0,0],[.045,0],[.045,.065],[.017,.065],[.017,.025],[0,.025]],.018,side*.29,.375,.22);
  }
  cable(u,[[.13,.27,-.33],[.18,.20,-.37],[.15,.13,-.38],[.05,.12,-.37],[-.06,.15,-.32]],.012);
  return u;
 }

 // Cache geometry once. Merge fixed pieces by material while retaining independently animated assemblies.
 function mergePieces(root){
   root.updateMatrixWorld(true);const inverse=new T.Matrix4().copy(root.matrixWorld).invert(),groups=new Map(),remove=[];
   function collect(node){
     if(node!==root && node.userData.role)return;
     if(node.isMesh){const geo=(node.geometry.index?node.geometry.toNonIndexed():node.geometry.clone());
       geo.applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,node.matrixWorld));
       if(!geo.attributes.normal)geo.computeVertexNormals();
       if(!groups.has(node.material))groups.set(node.material,[]);groups.get(node.material).push(geo);remove.push(node);
     }else node.children.forEach(collect);
   }
   collect(root);remove.forEach(m=>m.parent.remove(m));
   for(const [mat,geos] of groups){const pos=[],normal=[];for(const geo of geos){pos.push(...geo.attributes.position.array);normal.push(...geo.attributes.normal.array);geo.dispose();}
     const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('normal',new T.Float32BufferAttribute(normal,3));geo.computeBoundingSphere();root.add(new T.Mesh(geo,mat));
   }
 }
 const prototype=unit(0);const moving=[];prototype.traverse(o=>{if(o.userData.role)moving.push(o)});
 moving.forEach(mergePieces);mergePieces(prototype);
 function create(ox=0){const root=new T.Group(),orientation=new T.Group();root.userData.ox=ox;root.add(orientation);
   orientation.rotation.y=Math.PI/2;orientation.scale.setScalar(OHT_TRAVEL.scale);orientation.position.y=OHT_TRAVEL.base;
   const model=prototype.clone(true);orientation.add(model);root.userData.carriers=[];root.userData.wheels=[];root.userData.lowerGuides=[];root.userData.handWheels=[];
   model.traverse(o=>{const r=o.userData.role;if(r==='bodyMount')root.userData.mount=o;if(r==='carrier')root.userData.carriers.push(o);if(r==='travelWheel')root.userData.wheels.push(o);if(r==='lowerGuide')root.userData.lowerGuides.push(o);
     if(r==='handWheel'){let c=o.parent;while(c&&c.userData.role!=='carrier')c=c.parent;o.userData.side=c?c.userData.side:1;root.userData.handWheels.push(o);}});
   setHand(root,1);return root;
 }
 function setHand(root,p){p=Math.max(0,Math.min(1,p));for(const c of root.userData.carriers)c.position.set(c.userData.side*(.42-.29*p),.52+.14*p,0);}
 // 走過 dist 公尺：走行輪轉；下導輪貼著軌道下緣被帶著轉（左右兩邊方向相反）。
 // contact(side) 回傳那一側的換手輪現在有沒有碰到導軌，碰到才轉（轉的量從開始碰到算起）
 function roll(root,dist,contact){
   for(const w of root.userData.wheels)w.rotation.y=-dist/OHT_TRAVEL.wheelRadius;
   for(const w of root.userData.lowerGuides)w.rotation.y=w.userData.side*dist/(w.userData.r*OHT_TRAVEL.scale);
   for(const w of root.userData.handWheels){const on=contact&&contact(w.userData.side);
     if(on){if(w.userData.d0==null)w.userData.d0=dist-(w.userData.a||0)*w.userData.r*OHT_TRAVEL.scale;w.userData.a=(dist-w.userData.d0)/(w.userData.r*OHT_TRAVEL.scale);w.rotation.y=w.userData.side*w.userData.a;}
     else w.userData.d0=null;}
 }
 // 回轉軸承以下固定在車身上：rel＝車身方向減掉這組走行部的方向（走行部轉彎時，底座轉回去對齊車身）
 function mountYaw(root,rel){const m=root.userData.mount;if(m)m.rotation.y=rel;}
 function update(root,v,front){const state=front?v.hf:v.hr;let p=(state||v.hand)==='down'?0:1;
   const sw=v.handSw;if(sw && (sw.which==='both'||!sw.which||sw.which===(front?'f':'r'))){const u=1-Math.max(0,Math.min(1,sw.t/HAND_TIME));const to=sw.to==='up'?1:0;p=p+(to-p)*(u*u*(3-2*u));}
   setHand(root,p);roll(root,v.dist||0,null);
 }
 return {create,setHand,update,roll,mountYaw};
})();
