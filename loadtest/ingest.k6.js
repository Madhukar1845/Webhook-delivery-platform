import http from 'k6/http';
import {check,sleep} from 'k6';

export const options={
    vus:20,
    duration:'15s'
};
export default function (){
    const payload=JSON.stringify({
        type:'order.created',
        payload:{orderId:`ord_${Math.random()}`}
    })
    const params={
        headers:{'Content-Type':'application/json'}
    };
    const res=http.post('http://localhost:3000/events',payload,params);
    check(res,{
        'status is 202':(r)=>r.status===202,
    })
    sleep(0.1);
}