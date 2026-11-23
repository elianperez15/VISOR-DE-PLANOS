/* ──────────────────────────────────────────────────────────────────────
   measure-shapes.ts — Figuras de medición (métodos de MarkupLayer)

   Cota · ángulo · área · perímetro. Las distancias y áreas se expresan en la
   unidad real de la escala calibrada (ScaleManager); sin calibrar, en px.
   ────────────────────────────────────────────────────────────────────── */
import { fabric } from 'fabric';
import type { MarkupLayer } from '../anotaciones/lienzo/markup-layer';

export const measureShapeMethods = {
  /* ── Dimensión / Cota ───────────────────────────────────────────────── */
  _addDimension(this: MarkupLayer, x1,y1,x2,y2) {
    const dist      = this.scaleManager.distance(x1,y1,x2,y2);
    const label     = this.scaleManager.format(dist);
    const angle     = Math.atan2(y2-y1,x2-x1)*(180/Math.PI);
    const perpAngle = (angle+90)*Math.PI/180;
    const TICK_LEN  = 10;
    const strokeW   = this.strokeWidth, arrowSize = Math.max(8,strokeW*4);
    const dx        = Math.cos(perpAngle)*TICK_LEN, dy = Math.sin(perpAngle)*TICK_LEN;
    const midX=(x1+x2)/2, midY=(y1+y2)/2;
    const LABEL_OFFSET = 18;

    const group = new fabric.Group([
      new fabric.Line([x1,y1,x2,y2],{stroke:this.strokeColor,strokeWidth:strokeW,selectable:false}),
      new fabric.Line([x1-dx,y1-dy,x1+dx,y1+dy],{stroke:this.strokeColor,strokeWidth:strokeW,selectable:false}),
      new fabric.Line([x2-dx,y2-dy,x2+dx,y2+dy],{stroke:this.strokeColor,strokeWidth:strokeW,selectable:false}),
      new fabric.Triangle({left:x1,top:y1,width:arrowSize,height:arrowSize,fill:this.strokeColor,stroke:this.strokeColor,angle:angle-90,originX:'center',originY:'center',selectable:false}),
      new fabric.Triangle({left:x2,top:y2,width:arrowSize,height:arrowSize,fill:this.strokeColor,stroke:this.strokeColor,angle:angle+90,originX:'center',originY:'center',selectable:false}),
      new fabric.Text(label,{left:midX,top:midY-LABEL_OFFSET,fontSize:14,fontFamily:'Arial',fill:this.strokeColor,backgroundColor:'#1c213099',originX:'center',originY:'bottom',selectable:false}),
    ]);
    group.data = { type:'dimension', label };
    this._place(group);
  },

  /* ── Ángulo ─────────────────────────────────────────────────────────── */
  _addAngle(this: MarkupLayer, vertex, a1, a2) {
    const ARC_RADIUS  = 30;
    const LABEL_OFFSET = 16;
    const FULL_CIRCLE_DEG = 360;
    const ang1 = Math.atan2(a1.y-vertex.y, a1.x-vertex.x);
    const ang2 = Math.atan2(a2.y-vertex.y, a2.x-vertex.x);
    let   degrees = Math.abs((ang2-ang1) * 180/Math.PI);
    if (degrees > 180) degrees = FULL_CIRCLE_DEG - degrees;
    const label = degrees.toFixed(1) + '°';
    const midAngle = (ang1+ang2)/2;
    const arc = this._arcPath(vertex.x, vertex.y, ARC_RADIUS, ang1, ang2);

    const group = new fabric.Group([
      new fabric.Line([vertex.x,vertex.y,a1.x,a1.y],{stroke:this.strokeColor,strokeWidth:this.strokeWidth,selectable:false}),
      new fabric.Line([vertex.x,vertex.y,a2.x,a2.y],{stroke:this.strokeColor,strokeWidth:this.strokeWidth,selectable:false}),
      new fabric.Path(arc,{stroke:this.strokeColor,strokeWidth:1,fill:'transparent',selectable:false}),
      new fabric.Text(label,{
        left:vertex.x+(ARC_RADIUS+LABEL_OFFSET)*Math.cos(midAngle),
        top :vertex.y+(ARC_RADIUS+LABEL_OFFSET)*Math.sin(midAngle),
        fontSize:13,fontFamily:'Arial',fill:this.strokeColor,
        backgroundColor:'#1c213099',originX:'center',originY:'center',selectable:false,
      }),
    ]);
    group.data = { type:'angle', label };
    this._place(group);
  },

  _arcPath(this: MarkupLayer, cx,cy,r,a1,a2) {
    const x1=cx+r*Math.cos(a1), y1=cy+r*Math.sin(a1);
    const x2=cx+r*Math.cos(a2), y2=cy+r*Math.sin(a2);
    let diff = a2-a1; if (diff<0) diff+=2*Math.PI;
    const largeArc = diff > Math.PI ? 1 : 0;
    const sweep    = diff > 0 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  },

  /* ── Área ───────────────────────────────────────────────────────────── */
  _addArea(this: MarkupLayer, pts) {
    const pxArea  = this.scaleManager.polygonArea(pts);
    const label   = this.scaleManager.formatArea(pxArea);
    const centerX = pts.reduce((sum,p)=>sum+p.x,0)/pts.length;
    const centerY = pts.reduce((sum,p)=>sum+p.y,0)/pts.length;

    const polygon = new fabric.Polygon(pts,{
      stroke:this.strokeColor, strokeWidth:this.strokeWidth, fill:this.fillColor,
    });
    polygon.data = { type:'area', areaLabel:label };

    const labelText = new fabric.Text(label,{
      left:centerX, top:centerY, fontSize:14, fontFamily:'Arial',
      fill:this.strokeColor, backgroundColor:'#1c213099',
      originX:'center', originY:'center', selectable:false,
    });
    labelText.data = { type:'area-label' };

    this._place(polygon);
    this._place(labelText);
    this.onAreaReady && this.onAreaReady(label);
  },

  /* ── Perímetro (polilínea con longitud total) ───────────────────────── */
  _addPerimeter(this: MarkupLayer, pts) {
    let total = 0;
    for (let i=1;i<pts.length;i++) total += this.scaleManager.distance(pts[i-1].x,pts[i-1].y,pts[i].x,pts[i].y);
    const label = this.scaleManager.format(total);

    const obj = new fabric.Polyline(pts,{
      stroke:this.strokeColor, strokeWidth:this.strokeWidth, fill:'transparent',
    });
    obj.data = { type:'perimeter', label };

    const LABEL_OFFSET = 18;
    const midX = (pts[0].x+pts[pts.length-1].x)/2;
    const midY = Math.min(...pts.map(p=>p.y)) - LABEL_OFFSET;
    const labelText = new fabric.Text(label,{
      left:midX, top:midY, fontSize:14, fontFamily:'Arial',
      fill:this.strokeColor, backgroundColor:'#1c213099',
      originX:'center', originY:'bottom', selectable:false,
    });
    labelText.data = { type:'perimeter-label' };

    this._place(obj);
    this._place(labelText);
    this.onAreaReady && this.onAreaReady(`Perímetro: ${label}`);
  },
};
