// @ts-check
// تعريفات أشكال بيانات مشتركة (JSDoc typedefs) لطبقة lib/ — الغرض تحقّق TypeScript وقت
// الكتابة (عبر tsconfig.json's checkJs) لبيانات المشروع (غرف/فتحات/أثاث/سلالم) يلي بتتمرر
// بين planGeometry.js/build3d.js/ArchitectStudio.jsx، بدل ما نكتشف عدم تطابق الشكل وقت
// التشغيل بس. الأشكال هون أوسع من صفوف قاعدة البيانات الخام بـdatabase.types.ts — الغرفة
// وقت التشغيل بيصير عليها furniture/openings مضمومة (client-side join)، مو أعمدة فعلية.
/** @typedef {import("./database.types").Tables<"rooms">} RoomRow */
/** @typedef {import("./database.types").Tables<"openings">} OpeningRow */
/** @typedef {import("./database.types").Tables<"furniture">} FurnitureRow */
/** @typedef {import("./database.types").Tables<"stairs">} StairRow */

/** @typedef {{ x: number, y: number }} Point */

/**
 * @typedef {Object} Opening
 * @property {string} id
 * @property {"door"|"window"} kind
 * @property {number} position - المسافة بالمتر من أول طرف الجدار/الضلع
 * @property {("top"|"bottom"|"left"|"right")=} wall - للغرف المستطيلة بس
 * @property {number=} edge_index - للغرف الحرة (points) بس — فهرس الضلع بمصفوفة points
 */

/**
 * @typedef {Object} FurnitureItem
 * @property {string} id
 * @property {string} kind - مفتاح بـFURNITURE_KINDS
 * @property {number} x - بالمتر، نسبي لزاوية مربط إحاطة الغرفة (room.gx/gy)
 * @property {number} y
 * @property {number=} rotation - 0|90|180|270
 */

/**
 * شكل الغرفة وقت التشغيل — يضم أعمدة صف rooms الخام بالإضافة لمصفوفات openings/furniture
 * المضمومة من العميل (مو أعمدة فعلية بقاعدة البيانات).
 * @typedef {Object} Room
 * @property {string} id
 * @property {string} name
 * @property {number} gx
 * @property {number} gy
 * @property {number} gw
 * @property {number} gh
 * @property {string} color
 * @property {number} floor
 * @property {boolean} has_roof
 * @property {"flat"|"gable"|"hip"} roof_type
 * @property {number=} wall_height
 * @property {string=} wall_color
 * @property {string=} wall_material
 * @property {string=} floor_material
 * @property {Point[]=} points - null/undefined = غرفة مستطيلة عادية (gx/gy/gw/gh)؛ موجودة = غرفة حرة الشكل
 * @property {Opening[]=} openings
 * @property {FurnitureItem[]=} furniture
 */

/**
 * @typedef {Object} Stair
 * @property {string} id
 * @property {number} floor
 * @property {number} x
 * @property {number} y
 * @property {number=} rotation
 */

export {};
