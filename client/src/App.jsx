import { useState,useEffect } from "react";
function App(){
const [url,setUrl]=useState('');
const [eventTypes,setEventTypes]=useState('');
const [result,setResult]=useState(null);
const [deliveries,setDeliveries]=useState([]);

async function handleSubmit(e){
  e.preventDefault();
  const bodyObject={url,eventTypes:eventTypes.split(',').map((s=>s.trim()))}
  const response=await fetch('http://localhost:3000/subscriptions',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(bodyObject)
  })
  setResult(await response.json())
}

async function fetchDeliveries(){
  const response=await fetch('http://localhost:3000/deliveries')
  const data=await response.json();
  setDeliveries(data.deliveries);
}
useEffect(()=>{
  fetchDeliveries();
  const interval=setInterval(fetchDeliveries,3000);
  return ()=>clearInterval(interval) 
},[]);

async function fireEvent(type){
  const bodyObject={
    type,
    payload:{orderId:`demo_${Date.now()}`}
  };
  await fetch('http://localhost:3000/events',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(bodyObject)
  });
}

  return (
    <div>
      <h1>Webhook Delivery Platform-Delivery Dashboard</h1>
      <h2>Register Subscription</h2>
      <form onSubmit={handleSubmit}>
        <input type='text' placeholder="Webhook URL" value={url} onChange={(e)=>setUrl(e.target.value)}/>
        <input type='text'  placeholder='Event types (comma-seperated)' value={eventTypes} onChange={(e)=>setEventTypes(e.target.value)}/>
        <button type="submit">Register</button>
      </form>
      
      <h2>Recent Deliveries</h2>
      <table border='1'>
        <thead>
          <tr>
            <th>Status</th>
            <th>Latency</th>
            <th>Response Code</th>
            <th>Attempts</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((delivery)=>{
            return (
            <tr key={delivery._id}>
              <td>{delivery.status}</td>
              <td>{delivery.latencyMs}</td>
              <td>{delivery.responseCode}</td>
              <td>{delivery.attempts}</td>
            </tr>
          )})}
        
        </tbody>
      </table>

      <button onClick={()=>fireEvent('order.created')}>order.created</button>
      <button onClick={()=>fireEvent('order.cancelled')}>order.cancelled</button>
      <button onClick={()=>fireEvent('payment.failed')}>payment.failed</button>
      
      {result && <pre>{JSON.stringify(result,null,2)}</pre>}
    </div>
  )
}

export default App;

